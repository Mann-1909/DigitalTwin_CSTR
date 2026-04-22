import asyncio
import random
import math
import csv
import os
import datetime
from fastapi.responses import FileResponse
import numpy as np
from scipy.integrate import solve_ivp
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

class CSTRLogger:
    def __init__(self, log_dir="../logging"):
        self.log_dir = log_dir
        os.makedirs(self.log_dir, exist_ok=True)
        self.headers = [
            "Serial_No", "Time", "Fin", "Ca0", "Cb0", "T0", "Q", "Tcin", "Fc",
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
            inputs.get("Fin", 0), inputs.get("Ca0", 0), inputs.get("Cb0", 0),
            inputs.get("T0", 0), inputs.get("Q", 0), inputs.get("Tcin", 0), inputs.get("Fc", 0),
            outputs.get("Ca", 0), outputs.get("Cb", 0), outputs.get("Cc", 0), outputs.get("Cd", 0),
            outputs.get("T", 0), outputs.get("Tc", 0), outputs.get("h", 0), outputs.get("Xa", 0)
        ]
        with open(self.latest_file, mode='a', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(row)
        self.serial_no += 1

app = FastAPI()

@app.get("/")
async def health_check():
    return {"status": "online", "message": "Digital Twin Backend is running"}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class CSTRDigitalTwin:
    def __init__(self):
        # FIXED: Kinetics matched to the paper's 45% - 60% saturation profile
        self.k0 = 3.4e4
        self.E = 45000.0
        self.R = 8.314
        self.deltaH = -50000.0
        self.rho = 1000.0
        self.Cp = 4180.0
        
        # FIXED: Geometry scaled up to support Fin = 0.02 m3/s (Industrial scale)
        self.U = 500.0
        self.A = 2.5       # Heat transfer area for 500L reactor
        self.rho_c = 1000.0
        self.Cpc = 4180.0
        self.Vc = 0.1      # Coolant jacket volume
        self.Ar = 0.5      # Reactor cross-sectional area
        self.kv = 0.02     # Valve tuned so h stabilizes at exactly 1.0m for Fin=0.02
        
        # Starts safely at h=1.0m to prevent divide-by-zero volume
        self.state = [100.0, 100.0, 0.0, 0.0, 293.0, 293.0, 1.0]
        self.time = 0.0

    def odes(self, t, y, Fin, Ca0, Cb0, T0, Q, Tcin, Fc):
        Ca, Cb, Cc, Cd, T, Tc, h = y
        
        # Physical safety clamps
        h = max(1e-4, h)
        Ca = max(0.0, Ca)
        Cb = max(0.0, Cb)
        
        V = self.Ar * h
        k = self.k0 * math.exp(-self.E / (self.R * T))
        rate = k * Ca * Cb
        Fout = self.kv * math.sqrt(h)
        
        dCa_dt = (Fin / V) * (Ca0 - Ca) - rate
        dCb_dt = (Fin / V) * (Cb0 - Cb) - rate
        dCc_dt = -(Fin / V) * Cc + rate
        dCd_dt = -(Fin / V) * Cd + rate
        dT_dt = (Fin / V) * (T0 - T) + (-self.deltaH / (self.rho * self.Cp)) * rate - (self.U * self.A / (self.rho * self.Cp * V)) * (T - Tc) + Q / (self.rho * self.Cp * V)
        dTc_dt = (Fc / self.Vc) * (Tcin - Tc) + (self.U * self.A / (self.rho_c * self.Cpc * self.Vc)) * (T - Tc)
        dh_dt = (Fin - Fout) / self.Ar
        
        return [dCa_dt, dCb_dt, dCc_dt, dCd_dt, dT_dt, dTc_dt, dh_dt]

    def step(self, dt, inputs):
        Fin = inputs.get("Fin", 0.02)
        Ca0 = inputs.get("Ca0", 100.0)
        Cb0 = inputs.get("Cb0", 100.0)
        T0 = inputs.get("T0", 293.0)
        Q = inputs.get("Q", 0.0)
        Tcin = inputs.get("Tcin", 293.0)
        Fc = inputs.get("Fc", 0.01)

        sol = solve_ivp(
            self.odes,
            [self.time, self.time + dt],
            self.state,
            args=(Fin, Ca0, Cb0, T0, Q, Tcin, Fc),
            method='Radau',
            rtol=1e-5, atol=1e-7
        )

        self.state = sol.y[:, -1]
        self.state[0] = max(0.0, self.state[0])
        self.time += dt
        
        # Calculate conversion relative to feed
        Xa = (Ca0 - self.state[0]) / Ca0 if Ca0 > 0 else 0.0
        Xa = max(0.0, min(1.0, Xa))
        
        return {
            "Ca": float(self.state[0]), "Cb": float(self.state[1]), "Cc": float(self.state[2]),
            "Cd": float(self.state[3]), "T": float(self.state[4]), "Tc": float(self.state[5]),
            "h": float(self.state[6]), "Xa": float(Xa * 100.0)
        }

twin = CSTRDigitalTwin()
logger = CSTRLogger()
sim_state = {"is_running": False}

gui_inputs = {
    "mode": "Simulation",
    "Fin": 0.02, "T0": 293.0, "Ca0": 100.0, "Cb0": 100.0,
    "Q": 0.0, "Tcin": 293.0, "Fc": 0.01
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
                        "Fin": round(gui_inputs["Fin"] * (1 + random.uniform(-0.02, 0.02)), 8),
                        "T0": round(gui_inputs["T0"] + random.uniform(-0.5, 0.5), 2),
                        "Ca0": round(gui_inputs["Ca0"] + random.uniform(-0.1, 0.1), 2),
                        "Cb0": round(gui_inputs["Cb0"] + random.uniform(-0.1, 0.1), 2),
                        "Q": round(gui_inputs["Q"] + random.uniform(-5.0, 5.0), 2),
                        "Tcin": round(gui_inputs["Tcin"] + random.uniform(-0.5, 0.5), 2),
                        "Fc": round(gui_inputs["Fc"] * (1 + random.uniform(-0.02, 0.02)), 8)
                    }

                logger.log_data(current_time, gui_inputs, sim_data)
                await websocket.send_json(payload)

            await asyncio.sleep(1.0) 

    except Exception as e:
        pass

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)