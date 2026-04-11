import asyncio
import random
import math
import csv
import os
import numpy as np
from scipy.integrate import solve_ivp
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

class CSTRLogger:
    def __init__(self, filename="../logging/cstr_log.csv"):
        self.filename = filename
        self.serial_no = 1
        self.headers = [
            "Serial_No", "Time", "Fin", "Ca0", "Cb0", "T0", "Q", "Tcin", "Fc",
            "Ca", "Cb", "Cc", "Cd", "T", "Tc", "h", "Xa"
        ]
        self._init_file()

    def _init_file(self):
        file_exists = os.path.isfile(self.filename)
        with open(self.filename, mode='a', newline='') as f:
            writer = csv.writer(f)
            if not file_exists:
                writer.writerow(self.headers)

    def log_data(self, time_step, inputs, outputs):
        row = [
            self.serial_no,
            time_step,
            inputs.get("Fin", 0),
            inputs.get("Ca0", 0),
            inputs.get("Cb0", 0),
            inputs.get("T0", 0),
            inputs.get("Q", 0),
            inputs.get("Tcin", 0),
            inputs.get("Fc", 0),
            outputs.get("Ca", 0),
            outputs.get("Cb", 0),
            outputs.get("Cc", 0),
            outputs.get("Cd", 0),
            outputs.get("T", 0),
            outputs.get("Tc", 0),
            outputs.get("h", 0),
            outputs.get("Xa", 0)
        ]
        with open(self.filename, mode='a', newline='') as f:
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
            "Ca": float(self.state[0]),
            "Cb": float(self.state[1]),
            "Cc": float(self.state[2]),
            "Cd": float(self.state[3]),
            "T": float(self.state[4]),
            "Tc": float(self.state[5]),
            "h": float(self.state[6]),
            "Xa": float(Xa * 100.0)
        }

twin = CSTRDigitalTwin()
logger = CSTRLogger()

gui_inputs = {
    "mode": "Simulation",
    "Fin": 1.667e-6,
    "T0": 333.0,
    "Ca0": 100.0,
    "Cb0": 100.0,
    "Q": 0.0,
    "Tcin": 300.0,
    "Fc": 0.001
}

@app.post("/update_inputs")
async def update_inputs(inputs: dict):
    global gui_inputs
    gui_inputs.update(inputs)
    return {"status": "success"}

@app.websocket("/ws/cstr_data")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    time_step = 0
    try:
        while True:
            dt = 0.5
            sim_data = twin.step(dt, gui_inputs)

            payload = {
                "time": time_step,
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

            logger.log_data(time_step, gui_inputs, sim_data)

            await websocket.send_json(payload)
            time_step += 1
            await asyncio.sleep(0.5)

    except Exception as e:
        pass

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)