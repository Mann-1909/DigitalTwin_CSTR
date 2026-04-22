"use client";
import { useEffect, useState, useRef } from "react";
import { useTheme } from "next-themes";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
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
  { key: "Fin", label: "Feed Flow Rate", unit: "m³/s", step: 0.001 },
  { key: "T0", label: "Inlet Temp", unit: "K", step: 1.0 },
  { key: "Ca0", label: "Initial Conc. A", unit: "mol/m³", step: 0.1 },
  { key: "Cb0", label: "Initial Conc. B", unit: "mol/m³", step: 0.1 },
  { key: "Q", label: "Heat Duty", unit: "W", step: 10.0 },
  { key: "Tcin", label: "Coolant Temp", unit: "K", step: 1.0 },
  { key: "Fc", label: "Coolant Flow", unit: "m³/s", step: 0.001 },
];

type CSTRData = {
  time: string; 
  mode: string;
  [key: string]: any;
};

export default function Dashboard() {
  const [data, setData] = useState<CSTRData[]>([]);
  const [selectedOutput, setSelectedOutput] = useState<string>("Xa");
  const [selectedInputGraph, setSelectedInputGraph] = useState<string>("Fin");
  const [isRunning, setIsRunning] = useState<boolean>(false); 
  const [timeWindow, setTimeWindow] = useState<number>(30);
  
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  const [inputs, setInputs] = useState<InputValues>({
    mode: "Simulation",
    Fin: 0.02,
    T0: 293.0,
    Ca0: 100.0,
    Cb0: 100.0,
    Q: 0.0,
    Tcin: 293.0,
    Fc: 0.01,
  });

  const inputsRef = useRef(inputs);
  
  useEffect(() => { setMounted(true) }, []);
  
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
    const backendUrl = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000/ws/cstr_data";
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
        dataPoint[`input_${param.key}`] = currentInputsForGraph[param.key as keyof InputValues];
      });

      setData((prevData) => {
        const updatedData = [...prevData, dataPoint];
        return updatedData.length > 1000 ? updatedData.slice(1) : updatedData;
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

  const handleControl = async (action: "start" | "stop" | "reset") => {
    try {
      const httpUrl = process.env.NEXT_PUBLIC_HTTP_URL || "http://localhost:8000";
      await fetch(`${httpUrl}/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });

      if (action === "start") setIsRunning(true);
      if (action === "stop") setIsRunning(false);
      if (action === "reset") {
        setIsRunning(false);
        setData([]); 
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
  const currentInputParam = INPUT_PARAMS_LIST.find((p) => p.key === selectedInputGraph);
  const chartData = timeWindow === 0 ? data : data.slice(-timeWindow);

  // IBM/MATLAB VIBE COLORS
  const isDark = resolvedTheme === "dark";
  const gridColor = isDark ? "#1e293b" : "#e2e8f0"; 
  const axisColor = isDark ? "#64748b" : "#94a3b8"; 
  const tooltipBg = isDark ? "#020617" : "#ffffff"; 
  const tooltipBorder = isDark ? "#334155" : "#cbd5e1"; 
  const textColor = isDark ? "#f8fafc" : "#0f172a";
  
  const simColor = "#2563eb"; // Royal Blue
  const expColor = "#d97706"; // Amber
  const inputColor = "#059669"; // Emerald Green
  const xLabelColor = "#059669"; 
  const yLabelColor = "#2563eb"; 

  if (!mounted) return null;

  return (
    <div className="p-6 md:p-8 min-h-screen font-sans bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-50 transition-colors duration-300 overflow-x-hidden">
      
      {/* HEADER */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between mb-6 pb-4 border-b border-slate-200 dark:border-slate-800 gap-4">
        <div className="flex items-center gap-4">
          <h1 className="text-3xl font-extrabold tracking-tight">
            CSTR <span className="text-blue-600 dark:text-blue-500 font-light">Digital Twin</span>
          </h1>
          
          <button 
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="flex items-center justify-center w-9 h-9 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 shadow-sm transition-all"
            title="Toggle Theme"
          >
            {resolvedTheme === 'dark' ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
            )}
          </button>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-4">
          <div className="flex gap-2 mr-4 bg-white dark:bg-slate-900 p-1 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm">
            {!isRunning ? (
              <button onClick={() => handleControl("start")} className="bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-white text-white dark:text-slate-900 px-4 py-1.5 rounded-md text-sm font-semibold transition-all">
                Start Engine
              </button>
            ) : (
              <button onClick={() => handleControl("stop")} className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-1.5 rounded-md text-sm font-semibold transition-all animate-pulse">
                Pause Engine
              </button>
            )}
            <button onClick={() => handleControl("reset")} className="bg-rose-600 hover:bg-rose-700 text-white px-4 py-1.5 rounded-md text-sm font-semibold transition-all">
              Reset
            </button>
          </div>

          <div className="relative bg-slate-200 dark:bg-slate-800 rounded-lg p-1 flex items-center shadow-inner w-[300px]">
            {["Simulation", "Experiment", "Sim+Exp"].map((m) => (
              <button
                key={m}
                onClick={() => updateInputsOnBackend({ mode: m as InputValues["mode"] })}
                className={`flex-1 py-1.5 px-2 rounded-md text-center text-xs font-semibold relative z-10 transition-colors duration-200 ${
                  inputs.mode === m ? "text-white" : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                }`}
              >
                {m === "Sim+Exp" ? "Comparison" : m}
              </button>
            ))}
            <div
              className={`absolute top-1 bottom-1 w-[96px] bg-blue-600 rounded-md shadow-sm transition-transform duration-300 ease-in-out ${
                inputs.mode === "Simulation" ? "translate-x-0" : inputs.mode === "Experiment" ? "translate-x-[98px]" : "translate-x-[196px]"
              }`}
            ></div>
          </div>

          <button onClick={handleDownloadCSV} className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-500 text-slate-700 dark:text-slate-300 px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors shadow-sm">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
            Export Log
          </button>
        </div>
      </header>

      {/* TOP SECTION: 1/3 and 2/3 LAYOUT */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        
        <div className="lg:col-span-1 flex flex-col space-y-6">
          <div className="bg-white dark:bg-slate-900 p-2 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 w-full overflow-hidden h-[450px] flex items-center justify-center">
            <AnimatedDiagram
              t1={currentTemp.toFixed(1)} f1={currentTemp.toFixed(1)}
              t2={currentTemp.toFixed(1)} f2={currentTemp.toFixed(1)}
              t3={currentTemp.toFixed(1)} f3={currentTemp.toFixed(1)}
              t4={currentTemp.toFixed(1)} f4={currentTemp.toFixed(1)}
              t5={currentTemp.toFixed(1)} f5={currentTemp.toFixed(1)}
            />
          </div>
        </div>

        <div className="lg:col-span-2 flex flex-col space-y-4">
          <div className="bg-white dark:bg-slate-900 p-3 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 flex justify-between items-center">
            
            <div className="flex gap-3 flex-grow mr-4">
              <select
                title="conc"
                value={["Ca", "Cb", "Cc", "Cd"].includes(selectedOutput) ? selectedOutput : "default"}
                onChange={(e) => { if (e.target.value !== "default") setSelectedOutput(e.target.value); }}
                className={`flex-1 p-2 text-sm rounded-md outline-none border transition-colors cursor-pointer ${
                  ["Ca", "Cb", "Cc", "Cd"].includes(selectedOutput)
                    ? "bg-blue-50 border-blue-500 text-blue-700 dark:bg-slate-950 dark:border-blue-500 dark:text-blue-400 font-semibold"
                    : "bg-transparent border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-400"
                }`}
              >
                <option value="default" disabled>Concentration...</option>
                <option value="Ca">Conc. A (Ca)</option>
                <option value="Cb">Conc. B (Cb)</option>
                <option value="Cc">Conc. C (Cc)</option>
                <option value="Cd">Conc. D (Cd)</option>
              </select>

              <select
                title="temp"
                value={["T", "Tc"].includes(selectedOutput) ? selectedOutput : "default"}
                onChange={(e) => { if (e.target.value !== "default") setSelectedOutput(e.target.value); }}
                className={`flex-1 p-2 text-sm rounded-md outline-none border transition-colors cursor-pointer ${
                  ["T", "Tc"].includes(selectedOutput)
                    ? "bg-blue-50 border-blue-500 text-blue-700 dark:bg-slate-950 dark:border-blue-500 dark:text-blue-400 font-semibold"
                    : "bg-transparent border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-400"
                }`}
              >
                <option value="default" disabled>Temperature...</option>
                <option value="T">Reactor (T)</option>
                <option value="Tc">Coolant (Tc)</option>
              </select>

              <button
                onClick={() => setSelectedOutput("h")}
                className={`flex-1 p-2 text-sm rounded-md border transition-colors ${
                  selectedOutput === "h" 
                  ? "bg-blue-50 border-blue-500 text-blue-700 dark:bg-slate-950 dark:border-blue-500 dark:text-blue-400 font-semibold" 
                  : "bg-transparent border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-400"
                }`}
              >
                Liquid Level (h)
              </button>

              <button
                onClick={() => setSelectedOutput("Xa")}
                className={`flex-1 p-2 text-sm rounded-md border transition-colors ${
                  selectedOutput === "Xa" 
                  ? "bg-blue-50 border-blue-500 text-blue-700 dark:bg-slate-950 dark:border-blue-500 dark:text-blue-400 font-semibold" 
                  : "bg-transparent border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-400"
                }`}
              >
                Conversion (Xa)
              </button>
            </div>

            <div className="flex items-center gap-2 pl-4 border-l border-slate-200 dark:border-slate-700">
               <span className="text-xs text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wider">WINDOW</span>
               <select 
                 title="View Window"
                 value={timeWindow}
                 onChange={(e) => setTimeWindow(parseInt(e.target.value))}
                 className="bg-slate-50 dark:bg-slate-900 text-sm font-mono border border-slate-300 dark:border-slate-600 rounded text-slate-700 dark:text-slate-200 p-1.5 focus:border-blue-500 outline-none"
               >
                 <option value={30}>Last 30s</option>
                 <option value={60}>Last 60s</option>
                 <option value={300}>Last 5 Mins</option>
                 <option value={0}>All Time</option>
               </select>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 h-[385px] flex flex-col">
            <header className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
                {currentParam?.label}
              </h2>
              <div className="flex gap-4 text-xs font-mono text-slate-500 dark:text-slate-400">
                <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 bg-blue-600 rounded-sm"></span> Simulation</div>
                <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 bg-amber-500 rounded-sm"></span> Sensor</div>
              </div>
            </header>

            <div className="w-full flex-grow relative pb-2 pl-2">
              <div className="absolute inset-0">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 25 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                    <XAxis 
                      dataKey="time" 
                      stroke={axisColor} 
                      tick={{ fontSize: 11, fill: axisColor }} 
                      minTickGap={40} 
                      tickMargin={12}
                      label={{ 
                        value: "System Time (HH:MM:SS)", 
                        position: "insideBottom", 
                        offset: -20, 
                        fill: xLabelColor, 
                        fontSize: 13, 
                        fontWeight: "bold" 
                      }}
                    />
                    <YAxis 
                      stroke={axisColor} 
                      domain={["auto", "auto"]} 
                      tick={{ fontSize: 11, fill: axisColor }}
                      tickMargin={10}
                      label={{ 
                        value: currentParam?.unit, 
                        angle: -90, 
                        position: "insideLeft", 
                        fill: yLabelColor, 
                        fontSize: 14, 
                        fontWeight: "bold", 
                        offset: 5 
                      }}
                    />
                    <Tooltip contentStyle={{ backgroundColor: tooltipBg, border: `1px solid ${tooltipBorder}`, borderRadius: "6px", color: textColor, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />

                    {inputs.mode !== "Experiment" && (
                      <Line type="monotone" dataKey={`simulated_${selectedOutput}`} stroke={simColor} strokeWidth={2.5} dot={false} name="Simulated" isAnimationActive={false} />
                    )}
                    {inputs.mode !== "Simulation" && (
                      <Line type="step" dataKey={`experimental_${selectedOutput}`} stroke={expColor} strokeWidth={2} strokeDasharray="4 4" dot={false} name="Sensors" isAnimationActive={false} />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* BOTTOM SECTION */}
      <div className="border-t border-slate-200 dark:border-slate-800 pt-8 mt-4">
        <h2 className="text-xl font-semibold flex items-center gap-2 mb-6 text-slate-800 dark:text-slate-100">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600 dark:text-emerald-500"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><circle cx="12" cy="12" r="4"/></svg>
          System Inputs & Disturbance Control
        </h2>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
          {INPUT_PARAMS_LIST.map((param) => (
            <div
              key={param.key}
              onClick={() => setSelectedInputGraph(param.key)}
              className={`p-3 rounded-lg border transition-all cursor-pointer flex flex-col gap-2 ${
                selectedInputGraph === param.key
                  ? "bg-emerald-50 dark:bg-slate-950 border-emerald-500 shadow-sm ring-1 ring-emerald-500"
                  : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-600"
              }`}
            >
              <div className="flex justify-between items-center text-slate-700 dark:text-slate-300">
                <span className="text-sm font-bold">{param.key}</span>
                <span className="text-[10px] text-slate-500 dark:text-slate-400">{param.unit}</span>
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
                    ? "bg-slate-100 dark:bg-slate-950 text-slate-400 dark:text-slate-600 border-slate-200 dark:border-slate-800 cursor-not-allowed"
                    : "bg-slate-50 dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 border-slate-300 dark:border-slate-700 focus:border-emerald-500 dark:focus:border-emerald-500"
                }`}
              />
            </div>
          ))}
        </div>

        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 w-full h-[300px] flex flex-col">
          <header className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
              Control Trend: {currentInputParam?.label}
            </h3>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 bg-emerald-600 dark:bg-emerald-500 rounded-sm"></span>
              <span className="text-xs font-mono text-slate-500">Applied Value</span>
            </div>
          </header>

          <div className="w-full flex-grow relative pb-2 pl-2">
            <div className="absolute inset-0">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 25 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                  <XAxis 
                    dataKey="time" 
                    stroke={axisColor} 
                    tick={{ fontSize: 11, fill: axisColor }} 
                    minTickGap={40} 
                    tickMargin={12}
                    label={{ 
                      value: "System Time (HH:MM:SS)", 
                      position: "insideBottom", 
                      offset: -20, 
                      fill: xLabelColor, 
                      fontSize: 13, 
                      fontWeight: "bold" 
                    }}
                  />
                  <YAxis 
                    stroke={axisColor} 
                    domain={["auto", "auto"]} 
                    tick={{ fontSize: 11, fill: axisColor }}
                    tickMargin={10}
                    label={{ 
                      value: currentInputParam?.unit, 
                      angle: -90, 
                      position: "insideLeft", 
                      fill: yLabelColor, 
                      fontSize: 14, 
                      fontWeight: "bold", 
                      offset: 5 
                    }}
                  />
                  <Tooltip contentStyle={{ backgroundColor: tooltipBg, border: `1px solid ${tooltipBorder}`, borderRadius: "6px", color: textColor, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                  <Line type="stepAfter" dataKey={`input_${selectedInputGraph}`} stroke={inputColor} strokeWidth={2.5} dot={false} name="Value" isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}