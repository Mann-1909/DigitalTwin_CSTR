import requests
import time

def test_temp(T):
    url = "http://127.0.0.1:8000/update_inputs"
    inputs = {
        "mode": "Simulation",
        "Fa": 1.388888e-6,
        "Fb": 1.388888e-6,
        "Ca_feed": 100.0,
        "Cb_feed": 100.0,
        "T0": T,
        "Q": 0.0,
        "Tcin": T,
        "Fc": 0.01,
    }
    try:
        requests.post(url, json=inputs)
    except:
        pass

if __name__ == "__main__":
    from main import twin, gui_inputs
    import config
    for T in [303.15, 313.15, 323.15, 333.15]:
        twin.state = [50.0, 50.0, 0.0, 0.0, T, T, config.NOMINAL_HEIGHT_M]
        inputs = gui_inputs.copy()
        inputs["T0"] = T
        inputs["Tcin"] = T
        for _ in range(15):
            sim_data = twin.step(60, inputs)
        print(f"T={T}K, Xa={sim_data['Xa']}, Ca={sim_data['Ca']}, rate={sim_data['rate_net']}")
