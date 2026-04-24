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

# Import all constants from your new config file
import config 

class CSTRLogger:
    def __init__(self, log_dir="../logging"):
        self.log_dir = log_dir
        os.makedirs(self.log_dir, exist_ok=True)
        self.headers = [
            "Serial_No", "Time",
            "Fa", "Fb", "Ca_feed", "Cb_feed", "T0", "Q", "Tcin", "Fc",
            "Ca", "Cb", "Cc", "Cd", "T", "Tc", "h",
            "Xa", "Fin", "Ca0_eff", "k_f", "rate_net"
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
        Fa      = inputs.get("Fa", 0)
        Fb      = inputs.get("Fb", 0)
        Fin     = Fa + Fb
        Ca_feed = inputs.get("Ca_feed", 0)
        Ca0_eff = (Fa * Ca_feed / Fin) if Fin > 0 else 0.0
        row = [
            self.serial_no, cpu_time_str,
            Fa, Fb, Ca_feed, inputs.get("Cb_feed", 0),
            inputs.get("T0", 0), inputs.get("Q", 0), inputs.get("Tcin", 0), inputs.get("Fc", 0),
            outputs.get("Ca", 0), outputs.get("Cb", 0), outputs.get("Cc", 0), outputs.get("Cd", 0),
            outputs.get("T", 0), outputs.get("Tc", 0), outputs.get("h", 0),
            outputs.get("Xa", 0), round(Fin, 8), round(Ca0_eff, 4),
            outputs.get("k_f", 0), outputs.get("rate_net", 0)
        ]
        with open(self.latest_file, mode='a', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(row)
        self.serial_no += 1

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class CSTRDigitalTwin:
    def __init__(self):
        # Initial state [Ca, Cb, Cc, Cd, T, Tc, h]
        # Start at Ca=50, Cb=50 so the conversion calculation works properly
        self.state = [50.0, 50.0, 0.0, 0.0, 303.0, 303.0, config.NOMINAL_HEIGHT_M]
        self.time  = 0.0

    def odes(self, t, y, Fa, Fb, Ca_feed, Cb_feed, T0, Q, Tcin, Fc):
        Ca, Cb, Cc, Cd, T, Tc, h = y

        h  = max(1e-4, h)
        Ca = max(0.0, Ca)
        Cb = max(0.0, Cb)
        Cc = max(0.0, Cc)
        Cd = max(0.0, Cd)

        Fin  = Fa + Fb                                  
        V    = config.CROSS_SECTION_M2 * h                              
        Fout = config.VALVE_COEFFICIENT * math.sqrt(h)                   

        # Irreversible kinetics (No Keq, no reverse rate)
        k_f  = config.PRE_EXPONENTIAL_FACTOR * math.exp(-config.ACTIVATION_ENERGY / (config.GAS_CONSTANT * T))
        rate = k_f * Ca * Cb 

        dCa_dt = (Fa * Ca_feed - Fin * Ca) / V - rate
        dCb_dt = (Fb * Cb_feed - Fin * Cb) / V - rate
        dCc_dt = (-Fin * Cc) / V + rate
        dCd_dt = (-Fin * Cd) / V + rate

        dT_dt = (
            (Fin / V) * (T0 - T)
            + (-config.ENTHALPY_REACTION / (config.DENSITY_LIQUID * config.HEAT_CAPACITY)) * rate
            - (config.OVERALL_HTC * config.HEAT_TRANSFER_AREA / (config.DENSITY_LIQUID * config.HEAT_CAPACITY * V)) * (T - Tc)
            + Q / (config.DENSITY_LIQUID * config.HEAT_CAPACITY * V)
        )

        dTc_dt = (
            (Fc / config.JACKET_VOLUME) * (Tcin - Tc)
            + (config.OVERALL_HTC * config.HEAT_TRANSFER_AREA / (config.DENSITY_COOLANT * config.HC_COOLANT * config.JACKET_VOLUME)) * (T - Tc)
        )

        dh_dt = (Fin - Fout) / config.CROSS_SECTION_M2

        return [dCa_dt, dCb_dt, dCc_dt, dCd_dt, dT_dt, dTc_dt, dh_dt]

    def step(self, dt, inputs):
        Fa      = inputs.get("Fa", 1.388888e-6)
        Fb      = inputs.get("Fb", 1.388888e-6)
        Ca_feed = inputs.get("Ca_feed", 100.0)   
        Cb_feed = inputs.get("Cb_feed", 100.0)   
        T0      = inputs.get("T0", 303.0)
        Q       = inputs.get("Q", 0.0)
        Tcin    = inputs.get("Tcin", 303.0)
        Fc      = inputs.get("Fc", 0.01)

        sol = solve_ivp(
            self.odes,
            [self.time, self.time + dt],
            self.state,
            args=(Fa, Fb, Ca_feed, Cb_feed, T0, Q, Tcin, Fc),
            method='Radau',
            rtol=1e-5, atol=1e-7
        )

        self.state = sol.y[:, -1]
        for i in range(4):
            self.state[i] = max(0.0, self.state[i])
        self.time += dt

        Ca, Cb, Cc, Cd, T, Tc, h = self.state

        Fin     = Fa + Fb
        Ca0_eff = (Fa * Ca_feed / Fin) if Fin > 0 else 0.0
        Xa      = 1.0 - Ca / Ca0_eff if Ca0_eff > 1e-10 else 0.0
        Xa      = max(0.0, min(1.0, Xa))

        k_f      = config.PRE_EXPONENTIAL_FACTOR * math.exp(-config.ACTIVATION_ENERGY / (config.GAS_CONSTANT * T))
        rate_net = k_f * Ca * Cb

        return {
            "Ca": float(Ca), "Cb": float(Cb),
            "Cc": float(Cc), "Cd": float(Cd),
            "T":  float(T),  "Tc": float(Tc),
            "h":  float(h),
            "Xa": float(Xa * 100.0),   
            "k_f":      round(k_f, 6),
            "rate_net": round(rate_net, 6),
        }

twin = CSTRDigitalTwin()
logger = CSTRLogger()
sim_state = {"is_running": False}

gui_inputs = {
    "mode":    "Simulation",
    "Fa":      1.388888e-6,    
    "Fb":      1.388888e-6,    
    "Ca_feed": 100.0,   
    "Cb_feed": 100.0,   
    "T0":      303.0,   
    "Q":       0.0,     
    "Tcin":    303.0,   
    "Fc":      0.01,    
}

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
        twin = CSTRDigitalTwin() 
        logger.reset_log()       
        
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

@app.websocket("/ws/cstr_data")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            if sim_state["is_running"]:
                dt = 1.0 
                sim_data = twin.step(dt, gui_inputs)

                current_time = datetime.datetime.now().strftime("%H:%M:%S")

                payload = {
                    "time": current_time,
                    "mode": gui_inputs["mode"],
                }

                for key, val in sim_data.items():
                    payload[f"simulated_{key}"] = round(val, 4)
                    noise_margin = val * 0.015
                    payload[f"experimental_{key}"] = round(val + random.uniform(-noise_margin, noise_margin), 4)

                if gui_inputs["mode"] == "Experiment":
                    payload["live_inputs"] = {
                        "Fa":      round(gui_inputs["Fa"]      * (1 + random.uniform(-0.02, 0.02)), 8),
                        "Fb":      round(gui_inputs["Fb"]      * (1 + random.uniform(-0.02, 0.02)), 8),
                        "Ca_feed": round(gui_inputs["Ca_feed"] + random.uniform(-0.1, 0.1), 2),
                        "Cb_feed": round(gui_inputs["Cb_feed"] + random.uniform(-0.1, 0.1), 2),
                        "T0":      round(gui_inputs["T0"]      + random.uniform(-0.5, 0.5), 2),
                        "Q":       round(gui_inputs["Q"]       + random.uniform(-5.0, 5.0), 2),
                        "Tcin":    round(gui_inputs["Tcin"]    + random.uniform(-0.5, 0.5), 2),
                        "Fc":      round(gui_inputs["Fc"]      * (1 + random.uniform(-0.02, 0.02)), 8),
                    }

                logger.log_data(current_time, gui_inputs, sim_data)
                await websocket.send_json(payload)

            await asyncio.sleep(1.0) 

    except Exception as e:
        pass

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)