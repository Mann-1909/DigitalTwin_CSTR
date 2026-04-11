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
        # Generates a new file with a timestamp every time you hit reset
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        self.latest_file = os.path.join(self.log_dir, f"cstr_log_{timestamp}.csv")
        self.serial_no = 1
        
        with open(self.latest_file, mode='w', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(self.headers)

    def log_data(self, time_step, inputs, outputs):
        row = [
            self.serial_no, time_step,
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class CSTRDigitalTwin:
    def __init__(self):
        self.k0 = 2.17e5
        self.E = 45000.0
        self.R = 8.314
        self.deltaH = -50000.0
        self.rho = 1000.0
        self.Cp = 4180.0
        self.U = 500.0
        self.A = 1.0
        self.rho_c = 1000.0
        self.Cpc = 4180.0
        self.Vc = 0.2
        self.Ar = 1.0
        self.kv = 0.002
        self.state = [100.0, 100.0, 0.0, 0.0, 333.0, 300.0, 0.0025]
        self.time = 0.0

    def odes(self, t, y, Fin, Ca0, Cb0, T0, Q, Tcin, Fc):
        Ca, Cb, Cc, Cd, T, Tc, h = y
        h = max(1e-6, h)
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
        Fin = inputs.get("Fin", 1.667e-6)
        Ca0 = inputs.get("Ca0", 100.0)
        Cb0 = inputs.get("Cb0", 100.0)
        T0 = inputs.get("T0", 333.0)
        Q = inputs.get("Q", 0.0)
        Tcin = inputs.get("Tcin", 300.0)
        Fc = inputs.get("Fc", 0.001)

        sol = solve_ivp(
            self.odes,
            [self.time, self.time + dt],
            self.state,
            args=(Fin, Ca0, Cb0, T0, Q, Tcin, Fc),
            method='Radau'
        )

        self.state = sol.y[:, -1]
        self.time += dt
        Xa = (Ca0 - self.state[0]) / Ca0 if Ca0 > 0 else 0.0
        
        return {
            "Ca": float(self.state[0]), "Cb": float(self.state[1]), "Cc": float(self.state[2]),
            "Cd": float(self.state[3]), "T": float(self.state[4]), "Tc": float(self.state[5]),
            "h": float(self.state[6]), "Xa": float(Xa * 100.0)
        }

# Global State
twin = CSTRDigitalTwin()
logger = CSTRLogger()
sim_state = {"is_running": False, "time_step": 0}

gui_inputs = {
    "mode": "Simulation",
    "Fin": 1.667e-6, "T0": 333.0, "Ca0": 100.0, "Cb0": 100.0,
    "Q": 0.0, "Tcin": 300.0, "Fc": 0.001
}

@app.post("/update_inputs")
async def update_inputs(inputs: dict):
    global gui_inputs
    gui_inputs.update(inputs)
    return {"status": "success"}

# --- NEW: Control Endpoint ---
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
        sim_state["time_step"] = 0
        twin = CSTRDigitalTwin() # Reset mathematical model to initial state
        logger.reset_log()       # Generate a brand new CSV file
        
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
            # Only calculate and stream data if the simulation is currently running
            if sim_state["is_running"]:
                dt = 0.5
                sim_data = twin.step(dt, gui_inputs)

                payload = {
                    "time": sim_state["time_step"],
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

                logger.log_data(sim_state["time_step"], gui_inputs, sim_data)
                await websocket.send_json(payload)
                
                sim_state["time_step"] += 1

            await asyncio.sleep(0.5) # Wait 0.5s whether running or paused

    except Exception as e:
        pass

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)