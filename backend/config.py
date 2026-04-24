# config.py

"""
Configuration parameters for the CSTR Digital Twin.
Modify these values to test different reactor geometries and kinetics.
"""

# ── Geometry & Hydraulics (Matched to 2.5L Pilot Plant) ──
REACTOR_VOLUME_L = 2.5         # Nominal working volume (Liters)
CROSS_SECTION_M2 = 0.015       # Cross-sectional area (m²)
NOMINAL_HEIGHT_M = 0.1667      # Nominal liquid height (m)

# Tuned to maintain height at exactly 16.67 cm for a total flow of 2.777e-6 m3/s
VALVE_COEFFICIENT = 6.803e-6   

# ── Kinetics (Reversible 2nd Order: r = k_f·Ca·Cb − k_r·Cc·Cd) ──
# Fitted to paper data: 15/16 conversion targets within range
PRE_EXPONENTIAL_FACTOR = 0.54     # A  (m³/(mol·s))
ACTIVATION_ENERGY      = 23800.0  # Ea (J/mol)
EQUILIBRIUM_CONSTANT   = 1.70     # Keq = k_f / k_r (dimensionless)
GAS_CONSTANT           = 8.314    # R  (J/(mol·K))

# ── Thermodynamics ──
ENTHALPY_REACTION = -50000.0    # J/mol (Exothermic)
DENSITY_LIQUID    = 1000.0      # kg/m³
HEAT_CAPACITY     = 4180.0      # J/(kg·K)

# ── Heat Exchanger (Coolant Jacket) ──
OVERALL_HTC        = 500.0      # U (W/m²·K)
HEAT_TRANSFER_AREA = 0.072      # A (m²)
JACKET_VOLUME      = 0.0009     # Vc (m³)
DENSITY_COOLANT    = 1000.0     # kg/m³
HC_COOLANT         = 4180.0     # J/(kg·K)