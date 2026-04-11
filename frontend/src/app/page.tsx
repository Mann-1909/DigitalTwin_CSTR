"use client";
import { useEffect, useState, useRef } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import AnimatedDiagram from "../components/AnimatedDiagram";

type InputValues = {
  mode: "Simulation" | "Experiment" | "Sim+Exp";
  Fin: number;
  T0: number;
  Ca0: number;
  Cb0: number;
  Q: number;
  Tcin: number;
  Fc: number;
};

const OUTPUT_PARAMS = [
  { key: "Ca", label: "Concentration A (Ca)", unit: "mol/m³" },
  { key: "Cb", label: "Concentration B (Cb)", unit: "mol/m³" },
  { key: "Cc", label: "Concentration C (Cc)", unit: "mol/m³" },
  { key: "Cd", label: "Concentration D (Cd)", unit: "mol/m³" },
  { key: "T", label: "Reactor Temp (T)", unit: "K" },
  { key: "h", label: "Liquid Level (h)", unit: "m" },
  { key: "Tc", label: "Coolant Temp (Tc)", unit: "K" },
  { key: "Xa", label: "Conversion (Xa)", unit: "%" },
];

const INPUT_PARAMS_LIST = [
  { key: "Fin", label: "Feed Flow Rate", unit: "m³/s", step: 0.000001 },
  { key: "T0", label: "Inlet Temp", unit: "K", step: 1.0 },
  { key: "Ca0", label: "Initial Conc. A", unit: "mol/m³", step: 0.1 },
  { key: "Cb0", label: "Initial Conc. B", unit: "mol/m³", step: 0.1 },
  { key: "Q", label: "Heat Duty", unit: "W", step: 10.0 },
  { key: "Tcin", label: "Coolant Temp", unit: "K", step: 1.0 },
  { key: "Fc", label: "Coolant Flow", unit: "m³/s", step: 0.0001 },
];

type CSTRData = {
  time: number;
  mode: string;
  [key: string]: any;
};

export default function Dashboard() {
  const [data, setData] = useState<CSTRData[]>([]);
  const [selectedOutput, setSelectedOutput] = useState<string>("T");
  const [selectedInputGraph, setSelectedInputGraph] = useState<string>("Fin");
  const [isRunning, setIsRunning] = useState<boolean>(false); // NEW: Track play state

  const [inputs, setInputs] = useState<InputValues>({
    mode: "Simulation",
    Fin: 1.667e-6,
    T0: 333.0,
    Ca0: 100.0,
    Cb0: 100.0,
    Q: 0.0,
    Tcin: 300.0,
    Fc: 0.001,
  });

  const inputsRef = useRef(inputs);
  useEffect(() => {
    inputsRef.current = inputs;
  }, [inputs]);

  const latestData = data.length > 0 ? data[data.length - 1] : null;
  const currentTemp = latestData
    ? inputs.mode === "Simulation"
      ? latestData.simulated_T
      : latestData.experimental_T
    : 298.0;

  useEffect(() => {
    // Change this:
    // const ws = new WebSocket("ws://localhost:8000/ws/cstr_data");

    // To this:
    const backendUrl =
      process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000/ws/cstr_data";
    const ws = new WebSocket(backendUrl);

    ws.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      let currentInputsForGraph = { ...inputsRef.current };

      if (payload.live_inputs && inputsRef.current.mode === "Experiment") {
        setInputs((prev) => ({ ...prev, ...payload.live_inputs }));
        currentInputsForGraph = {
          ...currentInputsForGraph,
          ...payload.live_inputs,
        };
      }

      const dataPoint = { ...payload };
      INPUT_PARAMS_LIST.forEach((param) => {
        dataPoint[`input_${param.key}`] =
          currentInputsForGraph[param.key as keyof InputValues];
      });

      setData((prevData) => {
        const updatedData = [...prevData, dataPoint];
        return updatedData.length > 50 ? updatedData.slice(1) : updatedData;
      });
    };

    return () => ws.close();
  }, []);

  const updateInputsOnBackend = async (newInputs: Partial<InputValues>) => {
    setInputs((prev) => ({ ...prev, ...newInputs }));
    try {
      const httpUrl = process.env.NEXT_PUBLIC_HTTP_URL || "http://localhost:8000";
      await fetch(`${httpUrl}/update_inputs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...inputsRef.current, ...newInputs }),
      });
    } catch (error) {
      console.error("Error updating inputs:", error);
    }
  };

  // --- NEW: Handle Start/Stop/Reset Actions ---
  const handleControl = async (action: "start" | "stop" | "reset") => {
    try {
      await fetch("http://localhost:8000/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });

      if (action === "start") setIsRunning(true);
      if (action === "stop") setIsRunning(false);
      if (action === "reset") {
        setIsRunning(false);
        setData([]); // Clear graphs on the UI instantly
      }
    } catch (error) {
      console.error("Error sending control command:", error);
    }
  };

  const handleDownloadCSV = () => {
    const httpUrl = process.env.NEXT_PUBLIC_HTTP_URL || "http://localhost:8000";
    window.open(`${httpUrl}/download_log`, "_blank");
  };

  const currentParam = OUTPUT_PARAMS.find((p) => p.key === selectedOutput);
  const currentInputParam = INPUT_PARAMS_LIST.find(
    (p) => p.key === selectedInputGraph,
  );

  return (
    <div className="p-6 md:p-8 bg-gray-900 min-h-screen text-white flex flex-col font-sans overflow-x-hidden">
      {/* HEADER */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between mb-6 pb-4 border-b border-gray-800 gap-4">
        <h1 className="text-3xl font-extrabold tracking-tighter">
          CSTR <span className="text-blue-500">Digital Twin</span>
        </h1>

        <div className="flex flex-col sm:flex-row items-center gap-4">
          {/* PLAYBACK CONTROLS */}
          <div className="flex gap-2 mr-4 bg-gray-800 p-1.5 rounded-full shadow-inner">
            {!isRunning ? (
              <button
                onClick={() => handleControl("start")}
                className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-1.5 rounded-full text-sm font-bold shadow-lg transition-transform active:scale-95"
              >
                ▶ Start
              </button>
            ) : (
              <button
                onClick={() => handleControl("stop")}
                className="bg-amber-500 hover:bg-amber-400 text-white px-5 py-1.5 rounded-full text-sm font-bold shadow-lg transition-transform active:scale-95 animate-pulse"
              >
                ⏸ Pause
              </button>
            )}
            <button
              onClick={() => handleControl("reset")}
              className="bg-red-600 hover:bg-red-500 text-white px-5 py-1.5 rounded-full text-sm font-bold shadow-lg transition-transform active:scale-95"
            >
              ⏹ Reset
            </button>
          </div>

          {/* Mode Switcher */}
          <div className="relative bg-gray-800 rounded-full p-1 flex items-center shadow-inner w-75">
            {["Simulation", "Experiment", "Sim+Exp"].map((m) => (
              <button
                key={m}
                onClick={() =>
                  updateInputsOnBackend({ mode: m as InputValues["mode"] })
                }
                className={`flex-1 py-1.5 px-2 rounded-full text-center text-xs font-semibold relative z-10 transition-colors duration-200 ${inputs.mode === m ? "text-white" : "text-gray-400 hover:text-white"}`}
              >
                {m === "Sim+Exp" ? "Comparison" : m}
              </button>
            ))}
            <div
              className={`absolute top-1 bottom-1 w-24 bg-blue-600 rounded-full shadow-lg transition-transform duration-300 ease-in-out ${
                inputs.mode === "Simulation"
                  ? "translate-x-0"
                  : inputs.mode === "Experiment"
                    ? "translate-x-24.5"
                    : "translate-x-49"
              }`}
            ></div>
          </div>

          <button
            onClick={handleDownloadCSV}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-full text-sm font-bold transition-colors shadow-lg shadow-emerald-900/20 active:scale-95"
          >
            <span>📥</span> CSV
          </button>
        </div>
      </header>

      {/* TOP SECTION: 1/3 and 2/3 LAYOUT */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* LEFT COLUMN: Just the Diagram */}
        <div className="lg:col-span-1 flex flex-col space-y-6">
          <div className="bg-white p-2 rounded-2xl shadow-xl flex items-center justify-center border border-gray-700 w-full overflow-hidden h-full min-h-100">
            <AnimatedDiagram
              t1={currentTemp.toFixed(1)}
              f1={currentTemp.toFixed(1)}
              t2={currentTemp.toFixed(1)}
              f2={currentTemp.toFixed(1)}
              t3={currentTemp.toFixed(1)}
              f3={currentTemp.toFixed(1)}
              t4={currentTemp.toFixed(1)}
              f4={currentTemp.toFixed(1)}
              t5={currentTemp.toFixed(1)}
              f5={currentTemp.toFixed(1)}
            />
          </div>
        </div>

        {/* RIGHT COLUMN: Output Graphs */}
        <div className="lg:col-span-2 flex flex-col space-y-4">
          <div className="bg-gray-800 p-4 rounded-2xl shadow-xl border border-gray-700">
            <div className="grid grid-cols-4 gap-3">
              <select
                title="conc"
                value={
                  ["Ca", "Cb", "Cc", "Cd"].includes(selectedOutput)
                    ? selectedOutput
                    : "default"
                }
                onChange={(e) => {
                  if (e.target.value !== "default")
                    setSelectedOutput(e.target.value);
                }}
                className={`w-full p-2 text-sm rounded outline-none border transition-colors cursor-pointer ${
                  ["Ca", "Cb", "Cc", "Cd"].includes(selectedOutput)
                    ? "bg-gray-900 border-blue-500 text-blue-400 font-bold"
                    : "bg-gray-800 border-gray-600 text-gray-300 hover:border-gray-500"
                }`}
              >
                <option value="default" disabled>
                  Concentration...
                </option>
                <option value="Ca">Conc. A (Ca)</option>
                <option value="Cb">Conc. B (Cb)</option>
                <option value="Cc">Conc. C (Cc)</option>
                <option value="Cd">Conc. D (Cd)</option>
              </select>

              <select
                title="temp"
                value={
                  ["T", "Tc"].includes(selectedOutput)
                    ? selectedOutput
                    : "default"
                }
                onChange={(e) => {
                  if (e.target.value !== "default")
                    setSelectedOutput(e.target.value);
                }}
                className={`w-full p-2 text-sm rounded outline-none border transition-colors cursor-pointer ${
                  ["T", "Tc"].includes(selectedOutput)
                    ? "bg-gray-900 border-blue-500 text-blue-400 font-bold"
                    : "bg-gray-800 border-gray-600 text-gray-300 hover:border-gray-500"
                }`}
              >
                <option value="default" disabled>
                  Temperature...
                </option>
                <option value="T">Reactor (T)</option>
                <option value="Tc">Coolant (Tc)</option>
              </select>

              <button
                onClick={() => setSelectedOutput("h")}
                className={`w-full p-2 text-sm rounded border transition-colors ${selectedOutput === "h" ? "bg-gray-900 border-blue-500 text-blue-400 font-bold" : "bg-gray-800 border-gray-600 text-gray-300 hover:border-gray-500"}`}
              >
                Liquid Level (h)
              </button>

              <button
                onClick={() => setSelectedOutput("Xa")}
                className={`w-full p-2 text-sm rounded border transition-colors ${selectedOutput === "Xa" ? "bg-gray-900 border-blue-500 text-blue-400 font-bold" : "bg-gray-800 border-gray-600 text-gray-300 hover:border-gray-500"}`}
              >
                Conversion (Xa)
              </button>
            </div>
          </div>

          <div
            className="bg-gray-800 p-6 rounded-2xl shadow-xl flex flex-col border border-gray-700 grow"
            style={{ minHeight: "400px" }}
          >
            <header className="flex items-center justify-between mb-4 pb-2 border-b border-gray-700">
              <h2 className="text-xl font-bold text-gray-100 flex items-center gap-2">
                <span className="text-red-400">📈</span> {currentParam?.label}
              </h2>
              <div className="flex gap-4 text-xs font-medium">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 bg-blue-500 rounded-full"></span>{" "}
                  Simulation
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 bg-red-500 rounded-full"></span>{" "}
                  Sensor Data
                </div>
              </div>
            </header>

            <div className="w-full grow relative pt-4">
              <div className="absolute inset-0">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={data}
                    margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#374151"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="time"
                      stroke="#9ca3af"
                      tick={{ fontSize: 12 }}
                    />
                    <YAxis
                      stroke="#9ca3af"
                      domain={["auto", "auto"]}
                      tick={{ fontSize: 12 }}
                      label={{
                        value: currentParam?.unit,
                        angle: -90,
                        position: "insideLeft",
                        fill: "#9ca3af",
                        offset: 15,
                      }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#1F2937",
                        border: "1px solid #374151",
                        borderRadius: "8px",
                      }}
                    />

                    {inputs.mode !== "Experiment" && (
                      <Line
                        type="monotone"
                        dataKey={`simulated_${selectedOutput}`}
                        stroke="#3b82f6"
                        strokeWidth={3}
                        dot={false}
                        name="Simulated"
                        isAnimationActive={false}
                      />
                    )}
                    {inputs.mode !== "Simulation" && (
                      <Line
                        type="monotone"
                        dataKey={`experimental_${selectedOutput}`}
                        stroke="#ef4444"
                        strokeWidth={2}
                        strokeDasharray="4 4"
                        dot={false}
                        name="Sensors"
                        isAnimationActive={false}
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ================= BOTTOM SECTION: INTERACTIVE INPUTS ================= */}
      <div className="border-t border-gray-800 pt-8 mt-4">
        <h2 className="text-2xl font-bold text-gray-100 flex items-center gap-2 mb-6">
          <span className="text-emerald-400">🎛️</span> Input Parameters &
          History
        </h2>

        {/* 7 Interactive Input Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
          {INPUT_PARAMS_LIST.map((param) => (
            <div
              key={param.key}
              onClick={() => setSelectedInputGraph(param.key)}
              className={`p-3 rounded-xl border transition-all cursor-pointer flex flex-col gap-2 ${
                selectedInputGraph === param.key
                  ? "bg-gray-800 border-emerald-500 shadow-md shadow-emerald-900/20 ring-1 ring-emerald-500"
                  : "bg-gray-800/50 border-gray-700 hover:border-gray-500"
              }`}
            >
              <div className="flex justify-between items-center text-gray-300">
                <span className="text-sm font-bold">{param.key}</span>
                <span className="text-[10px] text-gray-500">{param.unit}</span>
              </div>
              <input
                title="num"
                type="number"
                step={param.step}
                value={inputs[param.key as keyof InputValues]}
                disabled={inputs.mode === "Experiment"}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val)) updateInputsOnBackend({ [param.key]: val });
                }}
                onClick={(e) => e.stopPropagation()}
                className={`w-full px-2 py-1.5 font-mono text-sm text-right rounded border focus:outline-none transition-colors ${
                  inputs.mode === "Experiment"
                    ? "bg-gray-900/50 text-gray-500 border-gray-700/50 cursor-not-allowed"
                    : "bg-gray-900 text-emerald-400 border-gray-600 focus:border-emerald-400"
                }`}
              />
            </div>
          ))}
        </div>

        {/* INPUT HISTORY GRAPH */}
        <div className="bg-gray-800 p-6 rounded-2xl shadow-xl flex flex-col border border-gray-700 w-full h-100">
          <header className="flex items-center justify-between mb-4 pb-2 border-b border-gray-700">
            <h3 className="text-lg font-bold text-gray-100">
              Trend: {currentInputParam?.label}
            </h3>
            {inputs.mode === "Experiment" && (
              <span className="text-xs bg-red-900/30 text-red-400 px-2 py-1 rounded">
                Live Sensor Read
              </span>
            )}
          </header>

          <div className="w-full grow relative pt-2">
            <div className="absolute inset-0">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={data}
                  margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#374151"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="time"
                    stroke="#9ca3af"
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis
                    stroke="#9ca3af"
                    domain={["auto", "auto"]}
                    tick={{ fontSize: 12 }}
                    label={{
                      value: currentInputParam?.unit,
                      angle: -90,
                      position: "insideLeft",
                      fill: "#9ca3af",
                      offset: 15,
                    }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1F2937",
                      border: "1px solid #374151",
                      borderRadius: "8px",
                    }}
                  />
                  <Line
                    type="stepAfter"
                    dataKey={`input_${selectedInputGraph}`}
                    stroke="#10b981"
                    strokeWidth={3}
                    dot={false}
                    name="Value"
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
