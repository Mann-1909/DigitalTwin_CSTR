import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from main import CSTRDigitalTwin
import config

print("Time(min) | 30C | 40C | 50C | 60C")
for T_celsius in [30, 40, 50, 60]:
    T_kelvin = T_celsius + 273.15
    twin = CSTRDigitalTwin()
    twin.state = [50.0, 50.0, 0.0, 0.0, T_kelvin, T_kelvin, config.NOMINAL_HEIGHT_M]
    
    inputs = {
        "Fa": 1.388888e-6,
        "Fb": 1.388888e-6,
        "Ca_feed": 100.0,
        "Cb_feed": 100.0,
        "T0": T_kelvin,
        "Q": 0.0,
        "Tcin": T_kelvin,
        "Fc": 0.01,
    }
    
    print(f"--- T = {T_celsius}C ---")
    for m in range(1, 16):
        sim_data = twin.step(60, inputs)
        if m in [1, 3, 6, 9, 12, 15]:
            print(f"t={m} min, Xa={sim_data['Xa']:.4f}")
