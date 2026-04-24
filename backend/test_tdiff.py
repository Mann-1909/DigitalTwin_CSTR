import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from main import CSTRDigitalTwin
import config

print("Time(min) | T0=303, Tcin=303 | T0=333, Tcin=303 | T0=333, Tcin=333")
twin1 = CSTRDigitalTwin()
twin1.state = [50.0, 50.0, 0.0, 0.0, 303.0, 303.0, config.NOMINAL_HEIGHT_M]
inputs1 = {"Fa": 1.388888e-6, "Fb": 1.388888e-6, "Ca_feed": 100.0, "Cb_feed": 100.0, "T0": 303.0, "Q": 0.0, "Tcin": 303.0, "Fc": 0.01}

twin2 = CSTRDigitalTwin()
twin2.state = [50.0, 50.0, 0.0, 0.0, 303.0, 303.0, config.NOMINAL_HEIGHT_M]
inputs2 = {"Fa": 1.388888e-6, "Fb": 1.388888e-6, "Ca_feed": 100.0, "Cb_feed": 100.0, "T0": 333.0, "Q": 0.0, "Tcin": 303.0, "Fc": 0.01}

twin3 = CSTRDigitalTwin()
twin3.state = [50.0, 50.0, 0.0, 0.0, 303.0, 303.0, config.NOMINAL_HEIGHT_M]
inputs3 = {"Fa": 1.388888e-6, "Fb": 1.388888e-6, "Ca_feed": 100.0, "Cb_feed": 100.0, "T0": 333.0, "Q": 0.0, "Tcin": 333.0, "Fc": 0.01}

for m in range(1, 16):
    s1 = twin1.step(60, inputs1)
    s2 = twin2.step(60, inputs2)
    s3 = twin3.step(60, inputs3)
    if m in [1, 3, 6, 9, 12, 15]:
        print(f"t={m} min: X1={s1['Xa']:.4f}, X2={s2['Xa']:.4f}, X3={s3['Xa']:.4f}")
        print(f"         T1={s1['T']:.1f}, T2={s2['T']:.1f}, T3={s3['T']:.1f}")
