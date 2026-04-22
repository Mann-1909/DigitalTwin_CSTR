import asyncio
import random
import math
import csv
import os
import datetime
from fastapi.responses import FileResponse
from scipy.integrate import solve_ivp
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
import uvicorn


# ─────────────────────────────────────────────────────────────────────
#  LOGGER
# ─────────────────────────────────────────────────────────────────────
class CSTRLogger:
    def __init__(self, log_dir="../logging"):
        self.log_dir = log_dir
        os.makedirs(self.log_dir, exist_ok=True)
        # Updated headers: FA0 and FB0 replace the old single Fin
        self.headers = [
            "Serial_No", "Time",
            "FA0", "FB0", "CAin", "CBin", "T0", "Q", "Tcin", "Fc",
            "Ca", "Cb", "Cc", "Cd", "T", "Tc", "h", "Xa"
        ]
        self.latest_file = None
        self.reset_log()

    def reset_log(self):
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        self.latest_file = os.path.join(self.log_dir, f"cstr_log_{timestamp}.csv")
        self.serial_no = 1
        with open(self.latest_file, mode='w', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(self.headers)

    def log_data(self, cpu_time_str, inputs, outputs):
        row = [
            self.serial_no, cpu_time_str,
            inputs.get("FA0",  0), inputs.get("FB0",  0),
            inputs.get("CAin", 0), inputs.get("CBin", 0),
            inputs.get("T0",   0), inputs.get("Q",    0),
            inputs.get("Tcin", 0), inputs.get("Fc",   0),
            outputs.get("Ca",  0), outputs.get("Cb",  0),
            outputs.get("Cc",  0), outputs.get("Cd",  0),
            outputs.get("T",   0), outputs.get("Tc",  0),
            outputs.get("h",   0), outputs.get("Xa",  0),
        ]
        with open(self.latest_file, mode='a', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(row)
        self.serial_no += 1


# ─────────────────────────────────────────────────────────────────────
#  CSTR MATHEMATICAL MODEL  —  Dual Feed Streams  (FA0 ≠ FB0)
# ─────────────────────────────────────────────────────────────────────
class CSTRDigitalTwin:
    def __init__(self):

        # ── KINETICS ─────────────────────────────────────────────────
        # FIX 1: k0 was 2.17e5 in old code — correct value is 2.17e7
        self.k0  = 2.17e7       # m³/(mol·s)   pre-exponential factor
        self.E   = 45000.0      # J/mol         activation energy
        self.R   = 8.314        # J/(mol·K)     universal gas constant

        # ── THERMODYNAMICS ───────────────────────────────────────────
        self.deltaH = -50000.0  # J/mol         heat of reaction (exothermic)
        self.rho    = 1000.0    # kg/m³          liquid density
        self.Cp     = 4180.0    # J/(kg·K)       liquid heat capacity

        # ── HEAT TRANSFER ────────────────────────────────────────────
        self.U = 500.0          # W/(m²·K)       overall heat transfer coefficient
        self.A = 1.0            # m²             reactor–jacket heat transfer area

        # ── JACKET ───────────────────────────────────────────────────
        self.rho_c = 1000.0     # kg/m³          coolant density
        self.Cpc   = 4180.0     # J/(kg·K)       coolant heat capacity
        self.Vc    = 0.2        # m³             jacket volume

        # ── GEOMETRY ─────────────────────────────────────────────────
        self.Ar = 1.0           # m²             reactor cross-sectional area
        # FIX 2: kv is used with LINEAR h (Fout = kv·h), not sqrt(h)
        self.kv = 0.002         # m³/s           linearised outlet valve coefficient

        # ── INITIAL STATE  [Ca, Cb, Cc, Cd, T, Tc, h] ───────────────
        # FIX 3: h was 0.0025 in old code — far too small (V = 0.0025 m³).
        #         Use h = 0.5 m  →  V = 0.5 m³  (stable, physically realistic)
        self.state = [
            100.0,   # Ca  [mol/m³]   starts equal to feed
            100.0,   # Cb  [mol/m³]   starts equal to feed
            0.0,     # Cc  [mol/m³]   no product at start
            0.0,     # Cd  [mol/m³]   no product at start
            333.0,   # T   [K]        reactor temperature
            300.0,   # Tc  [K]        jacket temperature
            0.5      # h   [m]        half-full tank  ← FIXED
        ]
        self.time = 0.0

    # -----------------------------------------------------------------
    #  ODEs — 7 coupled differential equations
    #  Updated for dual feed streams: FA0 carries A, FB0 carries B
    # -----------------------------------------------------------------
    def odes(self, t, y, FA0, FB0, CAin, CBin, T0, Q, Tcin, Fc):
        Ca, Cb, Cc, Cd, T, Tc, h = y

        # ── Physical safety clamps (prevent solver from going unphysical)
        h  = max(1e-4, h)
        Ca = max(0.0, Ca)
        Cb = max(0.0, Cb)
        Cc = max(0.0, Cc)
        Cd = max(0.0, Cd)
        T  = max(250.0, T)

        # ── Eq. 3: Total inlet flow ───────────────────────────────────
        Fin = FA0 + FB0

        # ── Eq. 5: Reactor volume ─────────────────────────────────────
        V = self.Ar * h

        # ── Eq. 1: Arrhenius rate constant ────────────────────────────
        k = self.k0 * math.exp(-self.E / (self.R * T))

        # ── Eq. 2: Reaction rate  (nonlinear — product of two states) ─
        rate = k * Ca * Cb

        # ── Eq. 4: Outlet flow  — LINEAR valve model  Fout = kv·h ────
        # FIX 4: old code used kv·sqrt(h) — corrected to kv·h (linear)
        Fout = self.kv * h

        # ── Eqs. 6–9: Species mass balances ──────────────────────────
        # FIX 5: old code used (Fin/V)·(Cx0 - Cx) which is WRONG.
        #         Correct form: (inlet_molar_flow - Fout·Cx) / V  ±  rate
        #
        #  Stream A carries only species A  →  inlet for A = FA0·CAin
        #  Stream B carries only species B  →  inlet for B = FB0·CBin
        #  No C or D in either feed stream
        dCa_dt = (FA0 * CAin  - Fout * Ca) / V - rate
        dCb_dt = (FB0 * CBin  - Fout * Cb) / V - rate
        dCc_dt = (             - Fout * Cc) / V + rate
        dCd_dt = (             - Fout * Cd) / V + rate

        # ── Eq. 10: Reactor energy balance ────────────────────────────
        #  Both streams at same feed temperature T0
        #  Inlet enthalpy = Fin·ρ·Cp·(T0 - T)
        dT_dt = (
            (Fin / V) * (T0 - T)
            + (-self.deltaH / (self.rho * self.Cp)) * rate
            - (self.U * self.A / (self.rho * self.Cp * V)) * (T - Tc)
            + Q / (self.rho * self.Cp * V)
        )

        # ── Eq. 11: Jacket energy balance ─────────────────────────────
        dTc_dt = (
            (Fc / self.Vc) * (Tcin - Tc)
            + (self.U * self.A / (self.rho_c * self.Cpc * self.Vc)) * (T - Tc)
        )

        # ── Eq. 12: Liquid level balance ──────────────────────────────
        if h <= 0.0005 and Fin < Fout:
            dh_dt = 0.0   # prevent draining below minimum safe level
        else:
            dh_dt = (Fin - Fout) / self.Ar

        return [dCa_dt, dCb_dt, dCc_dt, dCd_dt, dT_dt, dTc_dt, dh_dt]

    # -----------------------------------------------------------------
    #  Advance one time step
    # -----------------------------------------------------------------
    def step(self, dt, inputs):
        FA0  = inputs.get("FA0",  0.8335e-6)   # flow rate of stream A [m³/s]
        FB0  = inputs.get("FB0",  0.8335e-6)   # flow rate of stream B [m³/s]
        CAin = inputs.get("CAin", 100.0)        # conc. of A in stream A [mol/m³]
        CBin = inputs.get("CBin", 100.0)        # conc. of B in stream B [mol/m³]
        T0   = inputs.get("T0",   333.0)        # feed temperature [K]
        Q    = inputs.get("Q",    0.0)          # external heat duty [W]
        Tcin = inputs.get("Tcin", 300.0)        # coolant inlet temperature [K]
        Fc   = inputs.get("Fc",   0.001)        # coolant flow rate [m³/s]

        sol = solve_ivp(
            self.odes,
            [self.time, self.time + dt],
            self.state,
            args=(FA0, FB0, CAin, CBin, T0, Q, Tcin, Fc),
            # FIX 6: changed from Radau to BDF — better for stiff nonlinear systems
            # with tighter tolerances to prevent accumulation error over long runs
            method='BDF',
            rtol=1e-6,
            atol=1e-8
        )

        self.state = sol.y[:, -1]

        # FIX 7: hard clamp ALL state variables after each step
        self.state[0] = max(0.0,    self.state[0])   # Ca
        self.state[1] = max(0.0,    self.state[1])   # Cb
        self.state[2] = max(0.0,    self.state[2])   # Cc
        self.state[3] = max(0.0,    self.state[3])   # Cd
        self.state[6] = max(0.0005, self.state[6])   # h

        self.time += dt

        # ── Eq. 13 + 14: Effective inlet conc. and conversion ─────────
        Fin      = FA0 + FB0
        Ca0_eff  = (FA0 * CAin) / Fin if Fin > 0 else 0.0
        Ca       = self.state[0]
        Xa       = (Ca0_eff - Ca) / Ca0_eff if Ca0_eff > 0 else 0.0
        Xa       = max(0.0, min(1.0, Xa))   # clamp to [0, 1]

        return {
            "Ca": round(float(Ca),               4),
            "Cb": round(float(self.state[1]),     4),
            "Cc": round(float(self.state[2]),     4),
            "Cd": round(float(self.state[3]),     4),
            "T":  round(float(self.state[4]),     4),
            "Tc": round(float(self.state[5]),     4),
            "h":  round(float(self.state[6]),     4),
            "Xa": round(float(Xa * 100.0),        4),
        }


# ─────────────────────────────────────────────────────────────────────
#  FASTAPI APP
# ─────────────────────────────────────────────────────────────────────
app = FastAPI()

@app.get("/")
async def health_check():
    return {"status": "online", "message": "CSTR Digital Twin Backend is running"}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────────────────────────────
#  GLOBAL STATE
# ─────────────────────────────────────────────────────────────────────
twin      = CSTRDigitalTwin()
logger    = CSTRLogger()
sim_state = {"is_running": False}

# Updated gui_inputs: FA0 and FB0 replace old single Fin
gui_inputs = {
    "mode": "Simulation",
    "FA0":  0.8335e-6,   # flow rate of stream A  [m³/s]  — default = Fin/2
    "FB0":  0.8335e-6,   # flow rate of stream B  [m³/s]  — default = Fin/2
    "CAin": 100.0,        # concentration of A in stream A  [mol/m³]
    "CBin": 100.0,        # concentration of B in stream B  [mol/m³]
    "T0":   333.0,        # feed temperature (both streams)  [K]
    "Q":    0.0,          # external heat duty  [W]
    "Tcin": 300.0,        # coolant inlet temperature  [K]
    "Fc":   0.001,        # coolant volumetric flow rate  [m³/s]
}


# ─────────────────────────────────────────────────────────────────────
#  REST ENDPOINTS
# ─────────────────────────────────────────────────────────────────────
@app.post("/update_inputs")
async def update_inputs(inputs: dict):
    global gui_inputs
    gui_inputs.update(inputs)
    return {"status": "success"}


@app.post("/control")
async def control_sim(command: dict):
    global sim_state, twin, logger
    cmd = command.get("action")

    if cmd == "start":
        sim_state["is_running"] = True
    elif cmd == "stop":
        sim_state["is_running"] = False
    elif cmd == "reset":
        sim_state["is_running"] = False
        twin   = CSTRDigitalTwin()   # reset model to initial conditions
        logger.reset_log()           # start a new timestamped CSV file

    return {"status": "success"}


@app.get("/download_log")
async def download_log():
    if logger.latest_file and os.path.exists(logger.latest_file):
        return FileResponse(
            path=logger.latest_file,
            filename=os.path.basename(logger.latest_file),
            media_type='text/csv'
        )
    return {"error": "Log file not generated yet."}


# ─────────────────────────────────────────────────────────────────────
#  WEBSOCKET — real-time data stream
# ─────────────────────────────────────────────────────────────────────
@app.websocket("/ws/cstr_data")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            if sim_state["is_running"]:
                dt = 1.0   # 1-second math step (matches 1-second UI refresh)

                sim_data = twin.step(dt, gui_inputs)

                # Current wall-clock time (HH:MM:SS)
                current_time = datetime.datetime.now().strftime("%H:%M:%S")

                # Total flow for frontend display convenience
                Fin_total = gui_inputs["FA0"] + gui_inputs["FB0"]

                payload = {
                    "time":      current_time,
                    "mode":      gui_inputs["mode"],
                    "Fin_total": round(Fin_total, 10),
                    "FA0":       round(gui_inputs["FA0"], 10),
                    "FB0":       round(gui_inputs["FB0"], 10),
                }

                # Simulated values + experimental (simulated + small sensor noise)
                for key, val in sim_data.items():
                    payload[f"simulated_{key}"]    = val
                    noise_margin                    = abs(val) * 0.015
                    payload[f"experimental_{key}"] = round(
                        val + random.uniform(-noise_margin, noise_margin), 4
                    )

                # Experiment mode: add sensor noise to input readings
                if gui_inputs["mode"] == "Experiment":
                    payload["live_inputs"] = {
                        "FA0":  round(gui_inputs["FA0"]  * (1 + random.uniform(-0.02, 0.02)), 10),
                        "FB0":  round(gui_inputs["FB0"]  * (1 + random.uniform(-0.02, 0.02)), 10),
                        "CAin": round(gui_inputs["CAin"] + random.uniform(-0.1,  0.1),   2),
                        "CBin": round(gui_inputs["CBin"] + random.uniform(-0.1,  0.1),   2),
                        "T0":   round(gui_inputs["T0"]   + random.uniform(-0.5,  0.5),   2),
                        "Q":    round(gui_inputs["Q"]    + random.uniform(-5.0,  5.0),   2),
                        "Tcin": round(gui_inputs["Tcin"] + random.uniform(-0.5,  0.5),   2),
                        "Fc":   round(gui_inputs["Fc"]   * (1 + random.uniform(-0.02, 0.02)), 8),
                    }

                logger.log_data(current_time, gui_inputs, sim_data)
                await websocket.send_json(payload)

            # 1-second intervals (kept from your original code)
            await asyncio.sleep(1.0)

    except Exception:
        pass


# ─────────────────────────────────────────────────────────────────────
#  ENTRY POINT
# ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)