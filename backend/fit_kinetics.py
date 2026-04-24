"""
Fit Arrhenius kinetic parameters (A, Ea) to the paper's experimental data.
Step 1: Fit k at each temperature independently  
Step 2: Fit Arrhenius (A, Ea) to the 4 k values
Run: venv/bin/python3 fit_kinetics.py
"""
import numpy as np
from scipy.integrate import solve_ivp
from scipy.optimize import minimize_scalar

# ── Experimental data from paper appendix (fraction) ─────────────────────────
exp_data = {
    303: ([1,3,6,9,12,15], [0.136, 0.280, 0.376, 0.414, 0.434, 0.442]),
    313: ([1,3,6,9,12,15], [0.179, 0.334, 0.412, 0.438, 0.449, 0.451]),
    323: ([1,3,6,9,12,15], [0.227, 0.380, 0.438, 0.450, 0.454, 0.455]),
    333: ([1,3,6,9,12,15], [0.276, 0.409, 0.448, 0.454, 0.455, 0.456]),
}

Ca0_eff = 50.0    # mol/m³
tau     = 900.0   # s  (V=2.5e-3 m³, Fin=2.777e-6 m³/s)
R_gas   = 8.314


def cstr_ode(t, y, k):
    Ca = max(y[0], 0.0)
    return [(Ca0_eff - Ca) / tau - k * Ca**2]


def simulate(k, t_query_min):
    t_max = max(t_query_min) * 60.0
    sol = solve_ivp(cstr_ode, [0, t_max], [Ca0_eff],
                    args=(k,), method='RK45', dense_output=True,
                    rtol=1e-8, atol=1e-10)
    Ca_q = sol.sol(np.array(t_query_min) * 60.0)[0]
    return np.clip((Ca0_eff - Ca_q) / Ca0_eff, 0, 1)


# ── Step 1: Fit k at each temperature ────────────────────────────────────────
print("=" * 60)
print("  STEP 1: Per-temperature k fit")
print("=" * 60)
k_values = {}
for T_K, (t_min, X_exp) in exp_data.items():
    X_exp_arr = np.array(X_exp)
    def sse_k(log_k, X_e=X_exp_arr, tm=t_min):
        k = np.exp(log_k)
        X_sim = simulate(k, tm)
        return np.sum((X_sim - X_e)**2)
    
    res = minimize_scalar(sse_k, bounds=(np.log(1e-6), np.log(1e-2)), method='bounded')
    k_opt = np.exp(res.x)
    k_values[T_K] = k_opt
    X_sim = simulate(k_opt, t_min)
    rmse = np.sqrt(res.fun / len(t_min))
    print(f"\n  T = {T_K} K  ->  k = {k_opt:.5e} m3/(mol*s)  RMSE = {rmse:.5f}")
    for tm, xe, xs in zip(t_min, X_exp, X_sim):
        print(f"    t={tm:2d}min  X_exp={xe:.3f}  X_sim={xs:.4f}  err={abs(xe-xs)*100:.3f}%")

# ── Step 2: Fit Arrhenius to k(T) ────────────────────────────────────────────
print("\n" + "=" * 60)
print("  STEP 2: Arrhenius fit to k(T)")
print("=" * 60)
T_arr = np.array(list(k_values.keys()), dtype=float)
k_arr = np.array(list(k_values.values()))

# ln(k) = ln(A) - Ea/(R*T)  ->  linear regression on 1/T vs ln(k)
inv_T = 1.0 / T_arr
ln_k  = np.log(k_arr)
slope, intercept = np.polyfit(inv_T, ln_k, 1)
Ea_fit = -slope * R_gas
A_fit  = np.exp(intercept)

print(f"\n  A  = {A_fit:.6e}  m3/(mol*s)")
print(f"  Ea = {Ea_fit:.1f}  J/mol  ({Ea_fit/1000:.3f} kJ/mol)")

# ── Step 3: Final validation with Arrhenius parameters ───────────────────────
print("\n" + "=" * 60)
print("  STEP 3: Validation with Arrhenius parameters")
print("=" * 60)
for T_K, (t_min, X_exp) in exp_data.items():
    k_T = A_fit * np.exp(-Ea_fit / (R_gas * T_K))
    X_sim = simulate(k_T, t_min)
    rmse = np.sqrt(np.mean((np.array(X_exp) - X_sim)**2))
    print(f"\n  T = {T_K} K  k_arrh = {k_T:.5e}  k_direct = {k_values[T_K]:.5e}  RMSE = {rmse:.5f}")
    for tm, xe, xs in zip(t_min, X_exp, X_sim):
        print(f"    t={tm:2d}min  X_exp={xe:.3f}  X_sim={xs:.4f}  err={abs(xe-xs)*100:.3f}%")

print(f"\n\n  >>> For config.py:")
print(f"  PRE_EXPONENTIAL_FACTOR = {A_fit:.6e}  # m3/(mol*s)")
print(f"  ACTIVATION_ENERGY      = {Ea_fit:.1f}   # J/mol")
