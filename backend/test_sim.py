import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from main import CSTRDigitalTwin
import config

for T_celsius in [30, 40, 50, 60]:
    T_kelvin = T_celsius + 273.15
    twin = CSTRDigitalTwin()
    twin.state = [0.0, 0.0, 0.0, 0.0, T_kelvin, T_kelvin, config.NOMINAL_HEIGHT_M]
    
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
    
    for _ in range(15):
        sim_data = twin.step(60, inputs)
    
    print(f"T={T_celsius}C, Xa={sim_data['Xa']}, k_f={sim_data['k_f']}")
