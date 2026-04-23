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
  Fa: number;
  Fb: number;
  Ca_feed: number;
  Cb_feed: number;
  T0: number;
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

const FA_DISPLAY_SCALE = 1e6; // Scales m³/s to µL/s for readability

const INPUT_PARAMS_LIST = [
  { key: "Fin",     label: "Total Flow",      unit: "µL/s",   step: 0,      scale: FA_DISPLAY_SCALE, readOnly: true },
  { key: "Fa",      label: "Feed A Flow",     unit: "µL/s",   step: 0.1,    scale: FA_DISPLAY_SCALE },
  { key: "Fb",      label: "Feed B Flow",     unit: "µL/s",   step: 0.1,    scale: FA_DISPLAY_SCALE },
  { key: "Ca_feed", label: "Conc. A in Feed", unit: "mol/m³", step: 0.1,    scale: 1 },
  { key: "Cb_feed", label: "Conc. B in Feed", unit: "mol/m³", step: 0.1,    scale: 1 },
  { key: "T0",      label: "Inlet Temp",      unit: "K",      step: 1.0,    scale: 1 },
  { key: "Q",       label: "Heat Duty",       unit: "W",      step: 10.0,   scale: 1 },
  { key: "Tcin",    label: "Coolant Temp",    unit: "K",      step: 1.0,    scale: 1 },
  { key: "Fc",      label: "Coolant Flow",    unit: "m³/s",   step: 0.0001, scale: 1 },
];

type CSTRData = {
  time: string; 
  mode: string;
  [key: string]: any;
};

export default function Dashboard() {
  const [data, setData] = useState<CSTRData[]>([]);
  const [selectedOutput, setSelectedOutput] = useState<string>("Xa");
  const [selectedInputGraph, setSelectedInputGraph] = useState<string>("Fa");
  const [isRunning, setIsRunning] = useState<boolean>(false); 
  const [timeWindow, setTimeWindow] = useState<number>(60);
  const [maximizedGraph, setMaximizedGraph] = useState<"output" | "input" | null>(null);
  
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  const [inputs, setInputs] = useState<InputValues>({
    mode: "Simulation",
    Fa: 0.01,
    Fb: 0.01,
    Ca_feed: 100.0,
    Cb_feed: 100.0,
    T0: 293.0,
    Q: 0.0,
    Tcin: 293.0,
    Fc: 0.01,
  });

  const inputsRef = useRef(inputs);
  useEffect(() => { setMounted(true) }, []);
  useEffect(() => { inputsRef.current = inputs; }, [inputs]);

  const latestData = data.length > 0 ? data[data.length - 1] : null;
  const currentTemp = latestData
    ? inputs.mode === "Simulation"
      ? latestData.simulated_T
      : latestData.experimental_T
    : inputs.T0;

  useEffect(() => {
    const backendUrl = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000/ws/cstr_data";
    const ws = new WebSocket(backendUrl);

    ws.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      let currentInputsForGraph = { ...inputsRef.current };

      if (payload.live_inputs && inputsRef.current.mode === "Experiment") {
        setInputs((prev) => ({ ...prev, ...payload.live_inputs }));
        currentInputsForGraph = { ...currentInputsForGraph, ...payload.live_inputs };
      }

      const dataPoint = { ...payload };
      INPUT_PARAMS_LIST.forEach((param) => {
        if (param.key === "Fin") {
          dataPoint[`input_Fin`] = currentInputsForGraph.Fa + currentInputsForGraph.Fb;
        } else {
          dataPoint[`input_${param.key}`] = currentInputsForGraph[param.key as keyof InputValues];
        }
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

  const toDisplay = (key: string, siValue: number): number => {
    const param = INPUT_PARAMS_LIST.find((p) => p.key === key);
    return param ? siValue * param.scale : siValue;
  };
  
  const fromDisplay = (key: string, displayValue: number): number => {
    const param = INPUT_PARAMS_LIST.find((p) => p.key === key);
    return param ? displayValue / param.scale : displayValue;
  };

  const currentParam = OUTPUT_PARAMS.find((p) => p.key === selectedOutput);
  const currentInputParam = INPUT_PARAMS_LIST.find((p) => p.key === selectedInputGraph);
  const chartData = timeWindow === 0 ? data : data.slice(-timeWindow);

  // THEME COLORS
  const isDark = resolvedTheme === "dark";
  const gridColor = isDark ? "#1e293b" : "#e2e8f0"; 
  const axisColor = isDark ? "#64748b" : "#94a3b8"; 
  const tooltipBg = isDark ? "#020617" : "#ffffff"; 
  const tooltipBorder = isDark ? "#334155" : "#cbd5e1"; 
  const textColor = isDark ? "#f8fafc" : "#0f172a";
  const simColor = "#2563eb"; 
  const expColor = "#d97706"; 
  const inputColor = "#059669"; 

  // FIXED: Wiring real data to the Animated Diagram
  const flowA_disp = toDisplay("Fa", inputs.Fa).toFixed(2);
  const flowB_disp = toDisplay("Fb", inputs.Fb).toFixed(2);
  const flowTotal_disp = toDisplay("Fin", inputs.Fa + inputs.Fb).toFixed(2);
  const coolFlow_disp = inputs.Fc.toFixed(4);

  if (!mounted) return null;

  // REUSABLE GRAPH COMPONENTS
  const renderOutputGraph = (isModal = false) => (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: isModal ? 20 : 15 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
        <XAxis dataKey="time" stroke={axisColor} tick={{ fontSize: 11, fill: axisColor }} minTickGap={40} tickMargin={10} label={isModal ? { value: "System Time (HH:MM:SS)", position: "insideBottom", offset: -15, fill: "#059669", fontSize: 13, fontWeight: "bold" } : undefined} />
        <YAxis stroke={axisColor} domain={["auto", "auto"]} tick={{ fontSize: 11, fill: axisColor }} tickMargin={10} label={{ value: currentParam?.unit, angle: -90, position: "insideLeft", fill: "#2563eb", fontSize: 14, fontWeight: "bold", offset: 5 }} />
        <Tooltip contentStyle={{ backgroundColor: tooltipBg, border: `1px solid ${tooltipBorder}`, borderRadius: "6px", color: textColor, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
        {inputs.mode !== "Experiment" && (
          <Line type="monotone" dataKey={`simulated_${selectedOutput}`} stroke={simColor} strokeWidth={2.5} dot={false} name="Simulated" isAnimationActive={false} />
        )}
        {inputs.mode !== "Simulation" && (
          <Line type="step" dataKey={`experimental_${selectedOutput}`} stroke={expColor} strokeWidth={2} strokeDasharray="4 4" dot={false} name="Sensors" isAnimationActive={false} />
        )}
      </LineChart>
    </ResponsiveContainer>
  );

  const renderInputGraph = (isModal = false) => (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: isModal ? 20 : 15 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
        <XAxis dataKey="time" stroke={axisColor} tick={{ fontSize: 11, fill: axisColor }} minTickGap={40} tickMargin={10} label={isModal ? { value: "System Time (HH:MM:SS)", position: "insideBottom", offset: -15, fill: "#059669", fontSize: 13, fontWeight: "bold" } : undefined} />
        <YAxis stroke={axisColor} domain={["auto", "auto"]} tick={{ fontSize: 11, fill: axisColor }} tickMargin={10} label={{ value: currentInputParam?.unit, angle: -90, position: "insideLeft", fill: inputColor, fontSize: 14, fontWeight: "bold", offset: 5 }} />
        <Tooltip contentStyle={{ backgroundColor: tooltipBg, border: `1px solid ${tooltipBorder}`, borderRadius: "6px", color: textColor, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
        <Line type="stepAfter" dataKey={`input_${selectedInputGraph}`} stroke={inputColor} strokeWidth={2.5} dot={false} name="Applied Value" isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );

  return (
    <div className="p-4 md:p-6 min-h-screen font-sans bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-50 transition-colors duration-300 overflow-x-hidden">
      
      {/* MODAL OVERLAY FOR MAXIMIZED GRAPHS */}
      {maximizedGraph && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-6">
          <div className="bg-white dark:bg-slate-900 w-full max-w-6xl h-[85vh] rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold flex items-center gap-3">
                {maximizedGraph === "output" ? (
                  <><span className="text-blue-500">📈</span> {currentParam?.label} Output</>
                ) : (
                  <><span className="text-emerald-500">🎛️</span> {currentInputParam?.label} Trend</>
                )}
              </h2>
              <button title="Maximize" onClick={() => setMaximizedGraph(null)} className="p-2 bg-slate-100 dark:bg-slate-800 hover:bg-rose-100 dark:hover:bg-rose-900/30 hover:text-rose-600 rounded-full transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>
            <div className="grow w-full relative">
              {maximizedGraph === "output" ? renderOutputGraph(true) : renderInputGraph(true)}
            </div>
          </div>
        </div>
      )}

      {/* HEADER */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between mb-6 pb-4 border-b border-slate-200 dark:border-slate-800 gap-4">
        <div className="flex items-center gap-4">
          <h1 className="text-3xl font-extrabold tracking-tight">
            CSTR <span className="text-blue-600 dark:text-blue-500 font-light">Digital Twin</span>
          </h1>
          <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="flex items-center justify-center w-9 h-9 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 shadow-sm transition-all" title="Toggle Theme">
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
              <button onClick={() => handleControl("start")} className="bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-white text-white dark:text-slate-900 px-4 py-1.5 rounded-md text-sm font-semibold transition-all">Start Engine</button>
            ) : (
              <button onClick={() => handleControl("stop")} className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-1.5 rounded-md text-sm font-semibold transition-all animate-pulse">Pause Engine</button>
            )}
            <button onClick={() => handleControl("reset")} className="bg-rose-600 hover:bg-rose-700 text-white px-4 py-1.5 rounded-md text-sm font-semibold transition-all">Reset</button>
          </div>

          <div className="relative bg-slate-200 dark:bg-slate-800 rounded-lg p-1 flex items-center shadow-inner w-75">
            {["Simulation", "Experiment", "Sim+Exp"].map((m) => (
              <button key={m} onClick={() => updateInputsOnBackend({ mode: m as InputValues["mode"] })} className={`flex-1 py-1.5 px-2 rounded-md text-center text-xs font-semibold relative z-10 transition-colors duration-200 ${inputs.mode === m ? "text-white" : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"}`}>
                {m === "Sim+Exp" ? "Comparison" : m}
              </button>
            ))}
            <div className={`absolute top-1 bottom-1 w-24 bg-blue-600 rounded-md shadow-sm transition-transform duration-300 ease-in-out ${inputs.mode === "Simulation" ? "translate-x-0" : inputs.mode === "Experiment" ? "translate-x-24.5" : "translate-x-49"}`}></div>
          </div>

          <button onClick={handleDownloadCSV} className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-500 text-slate-700 dark:text-slate-300 px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors shadow-sm">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
            Export
          </button>
        </div>
      </header>

      {/* 3-COLUMN COMPACT LAYOUT */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        
        {/* === LEFT COLUMN: System Inputs (25%) === */}
        <div className="xl:col-span-3 flex flex-col gap-4">
          <h2 className="text-lg font-semibold flex items-center gap-2 text-slate-800 dark:text-slate-100 border-b border-slate-200 dark:border-slate-800 pb-2">
            <span className="text-emerald-500">🎛️</span> Input Parameters
          </h2>
          
          <div className="flex flex-col gap-2">
            {INPUT_PARAMS_LIST.map((param) => (
              <div
                key={param.key}
                onClick={() => setSelectedInputGraph(param.key)}
                className={`p-2.5 rounded-lg border transition-all cursor-pointer flex justify-between items-center ${
                  selectedInputGraph === param.key
                    ? "bg-emerald-50 dark:bg-slate-900/80 border-emerald-500 shadow-sm ring-1 ring-emerald-500"
                    : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-600"
                }`}
              >
                <div className="flex flex-col">
                  <span className="text-sm font-bold text-slate-700 dark:text-slate-200 leading-tight">{param.label}</span>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">{param.unit}</span>
                </div>
                <input
                  title={param.label}
                  type={param.readOnly ? "text" : "number"}
                  step={param.step}
                  value={
                    param.key === "Fin" 
                      ? parseFloat(toDisplay("Fin", inputs.Fa + inputs.Fb).toPrecision(4))
                      : parseFloat(toDisplay(param.key, inputs[param.key as keyof InputValues] as number).toPrecision(4))
                  }
                  disabled={inputs.mode === "Experiment" || param.readOnly}
                  onChange={(e) => {
                    if(param.readOnly) return;
                    const displayVal = parseFloat(e.target.value);
                    if (!isNaN(displayVal)) {
                      const siVal = fromDisplay(param.key, displayVal);
                      updateInputsOnBackend({ [param.key]: siVal });
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className={`w-20 px-2 py-1 font-mono text-sm text-right rounded border focus:outline-none transition-colors ${
                    inputs.mode === "Experiment" || param.readOnly
                      ? "bg-slate-100 dark:bg-slate-950 text-slate-400 dark:text-slate-500 border-slate-200 dark:border-slate-800 cursor-not-allowed"
                      : "bg-slate-50 dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 border-slate-300 dark:border-slate-600 focus:border-emerald-500"
                  }`}
                />
              </div>
            ))}
          </div>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-tight mt-1">
            ⓘ Flow rates (Fin, Fa, Fb) display in <strong>µL/s</strong> for readability.
          </p>
        </div>

        {/* === CENTER COLUMN: Animated Diagram (33%) === */}
        <div className="xl:col-span-4 flex flex-col">
          <div className="bg-white dark:bg-slate-900 p-2 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 w-full h-full min-h-112.5 flex items-center justify-center">
            {/* FIXED: All variables correctly mapped to inputs and sensor data */}
            <AnimatedDiagram
              t1={inputs.T0.toFixed(1)} f1={flowA_disp}
              t2={inputs.T0.toFixed(1)} f2={flowB_disp}
              t3={inputs.Tcin.toFixed(1)} f3={coolFlow_disp}
              t4={(inputs.mode === 'Simulation' ? (latestData?.simulated_Tc ?? inputs.Tcin) : (latestData?.experimental_Tc ?? inputs.Tcin)).toFixed(1)} f4={coolFlow_disp}
              t5={currentTemp.toFixed(1)} f5={flowTotal_disp}
            />
          </div>
        </div>

        {/* === RIGHT COLUMN: Graphs (42%) === */}
        <div className="xl:col-span-5 flex flex-col gap-4">
          
          {/* Graph Controls Toolbar */}
          <div className="bg-white dark:bg-slate-900 p-2.5 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 flex justify-between items-center gap-2">
            <select
              title="conc"
              value={["Ca","Cb","Cc","Cd"].includes(selectedOutput) ? selectedOutput : "default"}
              onChange={(e) => { if (e.target.value !== "default") setSelectedOutput(e.target.value); }}
              className={`flex-1 p-1.5 text-xs rounded outline-none border transition-colors cursor-pointer ${
                ["Ca","Cb","Cc","Cd"].includes(selectedOutput)
                  ? "bg-blue-50 border-blue-500 text-blue-700 dark:bg-slate-950 dark:border-blue-500 dark:text-blue-400 font-bold"
                  : "bg-transparent border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-400"
              }`}
            >
              <option value="default" disabled>Conc...</option>
              <option value="Ca">Ca</option>
              <option value="Cb">Cb</option>
              <option value="Cc">Cc</option>
              <option value="Cd">Cd</option>
            </select>

            <select
              title="temp"
              value={["T","Tc"].includes(selectedOutput) ? selectedOutput : "default"}
              onChange={(e) => { if (e.target.value !== "default") setSelectedOutput(e.target.value); }}
              className={`flex-1 p-1.5 text-xs rounded outline-none border transition-colors cursor-pointer ${
                ["T","Tc"].includes(selectedOutput)
                  ? "bg-blue-50 border-blue-500 text-blue-700 dark:bg-slate-950 dark:border-blue-500 dark:text-blue-400 font-bold"
                  : "bg-transparent border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-400"
              }`}
            >
              <option value="default" disabled>Temp...</option>
              <option value="T">T</option>
              <option value="Tc">Tc</option>
            </select>

            <button
              onClick={() => setSelectedOutput("h")}
              className={`flex-1 p-1.5 text-xs rounded border transition-colors ${selectedOutput === "h" ? "bg-blue-50 border-blue-500 text-blue-700 dark:bg-slate-950 dark:border-blue-500 dark:text-blue-400 font-bold" : "bg-transparent border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400"}`}
            >
              Level(h)
            </button>

            <button
              onClick={() => setSelectedOutput("Xa")}
              className={`flex-1 p-1.5 text-xs rounded border transition-colors ${selectedOutput === "Xa" ? "bg-blue-50 border-blue-500 text-blue-700 dark:bg-slate-950 dark:border-blue-500 dark:text-blue-400 font-bold" : "bg-transparent border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400"}`}
            >
              Conv(Xa)
            </button>

            <div className="border-l border-slate-300 dark:border-slate-700 pl-2">
               <select 
                 title="View Window"
                 value={timeWindow}
                 onChange={(e) => setTimeWindow(parseInt(e.target.value))}
                 className="bg-transparent text-xs font-mono border border-slate-200 dark:border-slate-700 rounded text-slate-700 dark:text-slate-300 p-1.5 focus:border-blue-500 outline-none"
               >
                 <option value={30}>30s</option>
                 <option value={60}>60s</option>
                 <option value={300}>5m</option>
                 <option value={0}>All</option>
               </select>
            </div>
          </div>

          {/* Output Graph Container */}
          <div className="bg-white dark:bg-slate-900 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 h-62.5 flex flex-col relative group">
            <header className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
                {currentParam?.label}
              </h2>
              
              {/* Maximize Button */}
              <button onClick={() => setMaximizedGraph("output")} className="absolute top-3 right-3 p-1.5 bg-slate-100 dark:bg-slate-800 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:text-blue-500" title="Maximize Graph">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/></svg>
              </button>
            </header>
            <div className="grow w-full -ml-2 pb-2">
              {renderOutputGraph()}
            </div>
          </div>

          {/* Input Graph Container */}
          <div className="bg-white dark:bg-slate-900 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 h-62.5 flex flex-col relative group">
            <header className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                 <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                 {currentInputParam?.label} Input Trend
              </h3>
              
              {/* Maximize Button */}
              <button onClick={() => setMaximizedGraph("input")} className="absolute top-3 right-3 p-1.5 bg-slate-100 dark:bg-slate-800 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:text-emerald-500" title="Maximize Graph">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/></svg>
              </button>
            </header>
            <div className="grow w-full -ml-2 pb-2">
               {renderInputGraph()}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}