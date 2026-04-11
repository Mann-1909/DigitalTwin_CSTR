"use client";
import { useEffect, useState, useRef } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import AnimatedDiagram from '../components/AnimatedDiagram';

type InputValues = {
  mode: 'Simulation' | 'Experiment' | 'Sim+Exp';
  Fin: number;
  T0: number;
  Ca0: number;
  Cb0: number;
  Q: number;
  Tcin: number;
  Fc: number;
};

// Define the available OUTPUT parameters
const OUTPUT_PARAMS = [
  { key: 'Ca', label: 'Concentration A (Ca)', unit: 'mol/m³' },
  { key: 'Cb', label: 'Concentration B (Cb)', unit: 'mol/m³' },
  { key: 'Cc', label: 'Concentration C (Cc)', unit: 'mol/m³' },
  { key: 'Cd', label: 'Concentration D (Cd)', unit: 'mol/m³' },
  { key: 'T',  label: 'Reactor Temp (T)', unit: 'K' },
  { key: 'h',  label: 'Liquid Level (h)', unit: 'm' },
  { key: 'Tc', label: 'Coolant Temp (Tc)', unit: 'K' },
  { key: 'Xa', label: 'Conversion (Xa)', unit: '%' },
];

// Define the available INPUT parameters for the new bottom section
const INPUT_PARAMS_LIST = [
  { key: 'Fin', label: 'Feed Flow Rate (Fin)', unit: 'm³/s' },
  { key: 'T0', label: 'Inlet Temp (T0)', unit: 'K' },
  { key: 'Ca0', label: 'Initial Conc. A (Ca0)', unit: 'mol/m³' },
  { key: 'Cb0', label: 'Initial Conc. B (Cb0)', unit: 'mol/m³' },
  { key: 'Q', label: 'Heat Duty (Q)', unit: 'W' },
  { key: 'Tcin', label: 'Coolant Temp (Tcin)', unit: 'K' },
  { key: 'Fc', label: 'Coolant Flow (Fc)', unit: 'm³/s' },
];

type CSTRData = {
  time: number;
  mode: string;
  [key: string]: any; 
};

export default function Dashboard() {
  const [data, setData] = useState<CSTRData[]>([]);
  const [selectedOutput, setSelectedOutput] = useState<string>('T'); 
  const [selectedInputGraph, setSelectedInputGraph] = useState<string>('Fin'); // New State for Input Graph
  
  const [inputs, setInputs] = useState<InputValues>({
    mode: 'Simulation',
    Fin: 1.667e-6,
    T0: 333.0,
    Ca0: 100.0,
    Cb0: 100.0,
    Q: 0.0,
    Tcin: 300.0,
    Fc: 0.001
  });

  // Use a ref to always have access to the latest inputs inside the WebSocket closure
  const inputsRef = useRef(inputs);
  useEffect(() => {
    inputsRef.current = inputs;
  }, [inputs]);

  const latestData = data.length > 0 ? data[data.length - 1] : null;
  const currentTemp = latestData ? (inputs.mode === 'Simulation' ? latestData.simulated_T : latestData.experimental_T) : 298.0;

  useEffect(() => {
    const ws = new WebSocket("ws://localhost:8000/ws/cstr_data");

    ws.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      
      let currentInputsForGraph = { ...inputsRef.current };

      if (payload.live_inputs && inputsRef.current.mode === 'Experiment') {
        setInputs(prev => ({ ...prev, ...payload.live_inputs }));
        currentInputsForGraph = { ...currentInputsForGraph, ...payload.live_inputs };
      }

      // Inject the current inputs into the historical payload so we can graph them over time
      const dataPoint = { ...payload };
      INPUT_PARAMS_LIST.forEach(param => {
        dataPoint[`input_${param.key}`] = currentInputsForGraph[param.key as keyof InputValues];
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
      await fetch("http://localhost:8000/update_inputs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...inputsRef.current, ...newInputs })
      });
    } catch (error) {
      console.error("Error updating inputs:", error);
    }
  };

  const NumberInput = ({ label, name, value, step, unit, disabled }: {
    label: string, name: keyof InputValues, value: number, step: number, unit: string, disabled: boolean
  }) => (
    <div className={`mb-2 p-2.5 rounded-md flex justify-between items-center border transition-colors ${disabled ? 'bg-gray-800 border-gray-700 opacity-70' : 'bg-gray-700 border-gray-600 hover:border-blue-500'}`}>
      <label className={`font-medium text-xs ${disabled ? 'text-gray-500' : 'text-gray-300'}`}>{label}</label>
      <div className="flex items-center gap-2">
        <input 
          title="num"
          type="number"
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => {
            const val = parseFloat(e.target.value);
            if (!isNaN(val)) updateInputsOnBackend({ [name]: val });
          }}
          className={`w-20 px-2 py-1 font-mono text-xs text-right rounded border focus:outline-none ${
            disabled 
              ? 'bg-gray-800 text-gray-500 border-gray-700 cursor-not-allowed' 
              : 'bg-gray-900 text-white border-gray-600 focus:border-blue-400 focus:ring-1 focus:ring-blue-400'
          }`}
        />
        <span className="text-[10px] text-gray-400 w-8">{unit}</span>
      </div>
    </div>
  );

  const currentParam = OUTPUT_PARAMS.find(p => p.key === selectedOutput);
  const currentInputParam = INPUT_PARAMS_LIST.find(p => p.key === selectedInputGraph);

  return (
    <div className="p-6 md:p-8 bg-gray-900 min-h-screen text-white flex flex-col font-sans overflow-x-hidden">
      
      {/* HEADER */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between mb-6 pb-4 border-b border-gray-800">
        <h1 className="text-3xl font-extrabold tracking-tighter mb-4 md:mb-0">CSTR <span className="text-blue-500">Digital Twin</span></h1>
        
        <div className="relative bg-gray-800 rounded-full p-1 flex items-center shadow-inner w-[300px]">
          {['Simulation', 'Experiment', 'Sim+Exp'].map(m => (
            <button
              key={m}
              onClick={() => updateInputsOnBackend({ mode: m as InputValues['mode'] })}
              className={`flex-1 py-1.5 px-2 rounded-full text-center text-xs font-semibold relative z-10 transition-colors duration-200 ${inputs.mode === m ? 'text-white' : 'text-gray-400 hover:text-white'}`}
            >
              {m === 'Sim+Exp' ? 'Comparison' : m}
            </button>
          ))}
          <div className={`absolute top-1 bottom-1 w-[96px] bg-blue-600 rounded-full shadow-lg transition-transform duration-300 ease-in-out ${
            inputs.mode === 'Simulation' ? 'translate-x-0' : 
            inputs.mode === 'Experiment' ? 'translate-x-[98px]' : 
            'translate-x-[196px]'
          }`}></div>
        </div>
      </header>

      {/* TOP SECTION: 1/3 and 2/3 LAYOUT */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        
        {/* ================= LEFT COLUMN (1/3 Width) ================= */}
        <div className="lg:col-span-1 flex flex-col space-y-6">
          <div className="bg-white p-2 rounded-2xl shadow-xl flex items-center justify-center border border-gray-700 w-full overflow-hidden h-[250px]">
            <AnimatedDiagram 
              t1={currentTemp.toFixed(1)} f1={currentTemp.toFixed(1)}
              t2={currentTemp.toFixed(1)} f2={currentTemp.toFixed(1)}
              t3={currentTemp.toFixed(1)} f3={currentTemp.toFixed(1)}
              t4={currentTemp.toFixed(1)} f4={currentTemp.toFixed(1)}
              t5={currentTemp.toFixed(1)} f5={currentTemp.toFixed(1)}
            />
          </div>

          <div className="bg-gray-800 p-5 rounded-2xl shadow-xl border border-gray-700 flex-grow">
            <h2 className="text-lg font-bold mb-4 text-gray-100 flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span className="text-blue-400">⚙️</span> Control Parameters
              </span>
              {inputs.mode === 'Experiment' && <span className="text-[10px] bg-red-900/50 text-red-400 px-2 py-0.5 rounded border border-red-800">Live Sensors</span>}
            </h2>
            <div className="grid grid-cols-1 gap-1">
              <NumberInput label="Flow Rate (Fin)" name="Fin" value={inputs.Fin} step={0.000001} unit="m³/s" disabled={inputs.mode === 'Experiment'} />
              <NumberInput label="Inlet Temp (T0)" name="T0" value={inputs.T0} step={1.0} unit="K" disabled={inputs.mode === 'Experiment'} />
              <NumberInput label="Conc. A (Ca0)" name="Ca0" value={inputs.Ca0} step={0.1} unit="mol/m³" disabled={inputs.mode === 'Experiment'} />
              <NumberInput label="Conc. B (Cb0)" name="Cb0" value={inputs.Cb0} step={0.1} unit="mol/m³" disabled={inputs.mode === 'Experiment'} />
              <NumberInput label="Heat Duty (Q)" name="Q" value={inputs.Q} step={10.0} unit="W" disabled={inputs.mode === 'Experiment'} />
              <NumberInput label="Coolant Temp (Tcin)" name="Tcin" value={inputs.Tcin} step={1.0} unit="K" disabled={inputs.mode === 'Experiment'} />
              <NumberInput label="Coolant Flow (Fc)" name="Fc" value={inputs.Fc} step={0.0001} unit="m³/s" disabled={inputs.mode === 'Experiment'} />
            </div>
          </div>
        </div>

        {/* ================= RIGHT COLUMN (2/3 Width) ================= */}
        <div className="lg:col-span-2 flex flex-col space-y-4">
          <div className="bg-gray-800 p-4 rounded-2xl shadow-xl border border-gray-700">
            <div className="grid grid-cols-4 gap-3">
              <select 
                title="conc"
                value={['Ca', 'Cb', 'Cc', 'Cd'].includes(selectedOutput) ? selectedOutput : 'default'}
                onChange={(e) => { if(e.target.value !== 'default') setSelectedOutput(e.target.value) }}
                className={`w-full p-2 text-sm rounded outline-none border transition-colors cursor-pointer ${
                  ['Ca', 'Cb', 'Cc', 'Cd'].includes(selectedOutput) 
                    ? 'bg-gray-900 border-blue-500 text-blue-400 font-bold' 
                    : 'bg-gray-800 border-gray-600 text-gray-300 hover:border-gray-500'
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
                value={['T', 'Tc'].includes(selectedOutput) ? selectedOutput : 'default'}
                onChange={(e) => { if(e.target.value !== 'default') setSelectedOutput(e.target.value) }}
                className={`w-full p-2 text-sm rounded outline-none border transition-colors cursor-pointer ${
                  ['T', 'Tc'].includes(selectedOutput) 
                    ? 'bg-gray-900 border-blue-500 text-blue-400 font-bold' 
                    : 'bg-gray-800 border-gray-600 text-gray-300 hover:border-gray-500'
                }`}
              >
                <option value="default" disabled>Temperature...</option>
                <option value="T">Reactor (T)</option>
                <option value="Tc">Coolant (Tc)</option>
              </select>

              <button 
                onClick={() => setSelectedOutput('h')}
                className={`w-full p-2 text-sm rounded border transition-colors ${
                  selectedOutput === 'h'
                    ? 'bg-gray-900 border-blue-500 text-blue-400 font-bold'
                    : 'bg-gray-800 border-gray-600 text-gray-300 hover:border-gray-500'
                }`}
              >
                Liquid Level (h)
              </button>

              <button 
                onClick={() => setSelectedOutput('Xa')}
                className={`w-full p-2 text-sm rounded border transition-colors ${
                  selectedOutput === 'Xa'
                    ? 'bg-gray-900 border-blue-500 text-blue-400 font-bold'
                    : 'bg-gray-800 border-gray-600 text-gray-300 hover:border-gray-500'
                }`}
              >
                Conversion (Xa)
              </button>
            </div>
          </div>

          <div className="bg-gray-800 p-6 rounded-2xl shadow-xl flex flex-col border border-gray-700 flex-grow" style={{ minHeight: '500px' }}>
            <header className="flex items-center justify-between mb-4 pb-2 border-b border-gray-700">
              <h2 className="text-xl font-bold text-gray-100 flex items-center gap-2">
                <span className="text-red-400">📈</span> {currentParam?.label}
              </h2>
              <div className="flex gap-4 text-xs font-medium">
                <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 bg-blue-500 rounded-full"></span> Simulation</div>
                <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 bg-red-500 rounded-full"></span> Sensor Data</div>
              </div>
            </header>

            <div className="w-full flex-grow relative pt-4">
              <div className="absolute inset-0">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                    <XAxis dataKey="time" stroke="#9ca3af" tick={{fontSize: 12}} />
                    <YAxis stroke="#9ca3af" domain={['auto', 'auto']} tick={{fontSize: 12}} label={{ value: currentParam?.unit, angle: -90, position: 'insideLeft', fill: "#9ca3af", offset: 15 }} />
                    <Tooltip contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '8px' }} />

                    {inputs.mode !== 'Experiment' && (
                      <Line type="monotone" dataKey={`simulated_${selectedOutput}`} stroke="#3b82f6" strokeWidth={3} dot={false} name="Simulated (Ideal)" isAnimationActive={false} />
                    )}
                    {inputs.mode !== 'Simulation' && (
                      <Line type="monotone" dataKey={`experimental_${selectedOutput}`} stroke="#ef4444" strokeWidth={2} strokeDasharray="4 4" dot={false} name="Experimental (Raw)" isAnimationActive={false} />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ================= NEW BOTTOM SECTION: INPUT PARAMETERS HISTORY ================= */}
      <div className="border-t border-gray-800 pt-8 mt-4">
        <h2 className="text-2xl font-bold text-gray-100 flex items-center gap-2 mb-6">
          <span className="text-green-400">🎛️</span> Input Parameters History
        </h2>

        {/* The 7 Column Buttons */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
          {INPUT_PARAMS_LIST.map(param => (
            <button 
              key={param.key}
              onClick={() => setSelectedInputGraph(param.key)}
              className={`p-2.5 text-sm rounded border transition-colors flex flex-col items-center justify-center gap-1 ${
                selectedInputGraph === param.key
                  ? 'bg-gray-900 border-green-500 text-green-400 font-bold shadow-md shadow-green-900/20'
                  : 'bg-gray-800 border-gray-600 text-gray-300 hover:border-gray-500'
              }`}
            >
              <span>{param.key}</span>
              <span className="text-[10px] font-normal opacity-70">{param.unit}</span>
            </button>
          ))}
        </div>

        {/* FULL WIDTH GRAPH FOR INPUTS */}
        <div className="bg-gray-800 p-6 rounded-2xl shadow-xl flex flex-col border border-gray-700 w-full h-[400px]">
          <header className="flex items-center justify-between mb-4 pb-2 border-b border-gray-700">
            <h3 className="text-lg font-bold text-gray-100">
              {currentInputParam?.label}
            </h3>
            {inputs.mode === 'Experiment' && (
               <span className="text-xs bg-red-900/30 text-red-400 px-2 py-1 rounded">Live Sensor Read</span>
            )}
          </header>

          <div className="w-full flex-grow relative pt-2">
            <div className="absolute inset-0">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                  <XAxis dataKey="time" stroke="#9ca3af" tick={{fontSize: 12}} />
                  <YAxis stroke="#9ca3af" domain={['auto', 'auto']} tick={{fontSize: 12}} label={{ value: currentInputParam?.unit, angle: -90, position: 'insideLeft', fill: "#9ca3af", offset: 15 }} />
                  <Tooltip contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '8px' }} />
                  
                  {/* Using stepAfter or monotone for inputs looks great. We use green to distinguish it from outputs */}
                  <Line 
                    type="monotone" 
                    dataKey={`input_${selectedInputGraph}`} 
                    stroke="#10b981" 
                    strokeWidth={3} 
                    dot={false} 
                    name="Applied Value" 
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