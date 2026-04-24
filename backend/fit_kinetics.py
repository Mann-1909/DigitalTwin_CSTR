import numpy as np
from scipy.integrate import solve_ivp

V = 0.0025
Fa = 1.388888e-6
Fb = 1.388888e-6
Fin = Fa + Fb
Ca_feed = 100.0
Cb_feed = 100.0
Ca0_eff = 50.0
R = 8.314

def run_sim(A, Ea, T_kelvin, t_end):
    k = A * np.exp(-Ea / (R * T_kelvin))
    def odes(t, y):
        Ca = y[0]
        rate = k * Ca**2
        dCa_dt = (Fa * Ca_feed - Fin * Ca) / V - rate
        return [dCa_dt]
    
    sol = solve_ivp(odes, [0, t_end], [0.0], method='Radau')
    Ca = sol.y[0][-1]
    return 1.0 - Ca / Ca0_eff

# Let's do a grid search or just print for some values
# Paper Ea = 41000 to 48000
Ea = 45000.0
# To match X(30C, 1min) = 0.136
# We can guess A
for A in [1e2, 5e2, 1e3, 5e3, 1e4, 5e4]:
    X_30_1 = run_sim(A, Ea, 303.15, 60)
    X_30_15 = run_sim(A, Ea, 303.15, 900)
    X_60_1 = run_sim(A, Ea, 333.15, 60)
    X_60_15 = run_sim(A, Ea, 333.15, 900)
    print(f"A={A:.1e}: 30C(1m)={X_30_1:.4f}, 30C(15m)={X_30_15:.4f} | 60C(1m)={X_60_1:.4f}, 60C(15m)={X_60_15:.4f}")
