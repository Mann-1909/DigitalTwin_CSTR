"""
Final validation: run the ACTUAL CSTRDigitalTwin class at all 4 temps.
Simulates 15 minutes (900 steps of dt=1s) at each temperature.
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from main import CSTRDigitalTwin

targets = {
    303: {1:(0.09,0.12), 3:(0.20,0.24), 6:(0.32,0.36), 15:(0.42,0.45)},
    313: {1:(0.13,0.16), 3:(0.27,0.31), 6:(0.37,0.41), 15:(0.45,0.48)},
    323: {1:(0.16,0.20), 3:(0.32,0.36), 6:(0.41,0.45), 15:(0.46,0.50)},
    333: {1:(0.22,0.30), 3:(0.38,0.44), 6:(0.44,0.48), 15:(0.48,0.55)},
}

total_ok = 0; total = 0

for T0 in [303, 313, 323, 333]:
    twin = CSTRDigitalTwin()
    twin.state = [50.0, 50.0, 0.0, 0.0, float(T0), float(T0), 0.1667]

    inputs = {
        "Fa": 1.388888e-6, "Fb": 1.388888e-6,
        "Ca_feed": 100.0, "Cb_feed": 100.0,
        "T0": float(T0), "Q": 0.0, "Tcin": float(T0), "Fc": 1e-5
    }

    print(f"\nT0 = {T0}K ({T0-273}C)")
    print(f"  {'t(min)':>7}  {'X%':>8}  {'target':>12}  {'status':>6}")

    for step in range(1, 901):
        result = twin.step(1.0, inputs)
        t_min = step // 60
        if step % 60 == 0 and t_min in [1, 3, 6, 9, 12, 15]:
            X = result["Xa"] / 100.0  # Xa is already in %
            tgt = targets[T0].get(t_min)
            if tgt:
                lo, hi = tgt
                ok = "OK" if lo <= X <= hi else "MISS"
                if ok == "OK": total_ok += 1
                total += 1
                print(f"  {t_min:7d}  {X*100:7.1f}%  [{lo*100:.0f}-{hi*100:.0f}%]  {ok:>6}")
            else:
                print(f"  {t_min:7d}  {X*100:7.1f}%")

print(f"\n{'='*50}")
print(f"  Result: {total_ok}/{total} targets hit")
print(f"{'='*50}")
