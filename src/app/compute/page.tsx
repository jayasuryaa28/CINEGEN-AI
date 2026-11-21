"use client";

import React, { useState, useEffect } from "react";
import {
  Cpu,
  Cloud,
  Server,
  Key,
  Shield,
  Zap,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Film,
  HardDrive,
  Activity,
  ArrowRight,
  Trash2,
  RefreshCw,
  DollarSign,
  HelpCircle,
} from "lucide-react";
import type { GpuOffer } from "@/compute/cloud/gpuCatalog";
import type { HardwareProfile } from "@/compute/local/hardwareDetector";
import type { CapabilityAdvice } from "@/compute/local/localCapabilityAdvisor";
import type { MaskedCredential } from "@/compute/cloud/credentialManager";
import type { ManagedInstanceRecord } from "@/compute/cloud/instanceManager";
import type { CostEstimateResult } from "@/compute/cloud/cloudCostEstimator";

export default function ComputePage() {
  const [activeTab, setActiveTab] = useState<"own_pc" | "cloud_gpu">("own_pc");
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  // Cloud GPU State
  const [selectedProvider, setSelectedProvider] = useState<"runpod" | "vast">("runpod");
  const [credentials, setCredentials] = useState<MaskedCredential[]>([]);
  const [inputApiKey, setInputApiKey] = useState("");
  const [testingKey, setTestingKey] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [gpuCatalog, setGpuCatalog] = useState<GpuOffer[]>([]);
  const [selectedGpuId, setSelectedGpuId] = useState<string>("rtx-3090");

  // Cost Estimator State
  const [estimateDurationMins, setEstimateDurationMins] = useState<number>(30);
  const [estimateResolution, setEstimateResolution] = useState<"720p" | "1080p" | "1440p" | "4K">("1080p");
  const [costEstimate, setCostEstimate] = useState<CostEstimateResult | null>(null);
  const [calculatingCost, setCalculatingCost] = useState(false);

  // Cloud Instances State
  const [instances, setInstances] = useState<ManagedInstanceRecord[]>([]);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionConfirmOpen, setProvisionConfirmOpen] = useState(false);

  // Own PC State
  const [hardwareProfile, setHardwareProfile] = useState<HardwareProfile | null>(null);
  const [capabilityAdvice, setCapabilityAdvice] = useState<CapabilityAdvice | null>(null);
  const [loadingHardware, setLoadingHardware] = useState(false);
  const [maxConcurrency, setMaxConcurrency] = useState<number>(1);
  const [memorySafetyLimitGb, setMemorySafetyLimitGb] = useState<number>(2.0);

  // Load all initial data
  useEffect(() => {
    loadSettings();
    loadCredentials();
    loadCatalog("runpod");
    loadHardwareDiagnostics();
    loadInstances();
  }, []);

  // Update cost estimate when duration, resolution, provider, or GPU changes
  useEffect(() => {
    runCostEstimate();
  }, [estimateDurationMins, estimateResolution, selectedProvider, selectedGpuId]);

  const loadSettings = async () => {
    try {
      const res = await fetch("/api/compute/mode");
      const data = await res.json();
      if (data.success && data.settings) {
        setActiveTab(data.settings.activeMode || "own_pc");
        if (data.settings.preferredCloudProvider) {
          setSelectedProvider(data.settings.preferredCloudProvider);
        }
        if (data.settings.preferredGpuId) {
          setSelectedGpuId(data.settings.preferredGpuId);
        }
        if (data.settings.maxLocalConcurrency) {
          setMaxConcurrency(data.settings.maxLocalConcurrency);
        }
      }
    } catch (err) {
      console.error("Failed to load compute settings:", err);
    } finally {
      setSettingsLoaded(true);
    }
  };

  const saveSettings = async (modeToSave?: "own_pc" | "cloud_gpu") => {
    setSavingSettings(true);
    try {
      const res = await fetch("/api/compute/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activeMode: modeToSave || activeTab,
          preferredCloudProvider: selectedProvider,
          preferredGpuId: selectedGpuId,
          maxLocalConcurrency: maxConcurrency,
          memorySafetyLimitGb,
        }),
      });
      const data = await res.json();
      if (data.success) {
        if (modeToSave) setActiveTab(modeToSave);
      }
    } catch (err) {
      console.error("Failed to save settings:", err);
    } finally {
      setSavingSettings(false);
    }
  };

  const loadCredentials = async () => {
    try {
      const res = await fetch("/api/compute/credentials");
      const data = await res.json();
      if (data.success && data.credentials) {
        setCredentials(data.credentials);
      }
    } catch (err) {
      console.error("Failed to load credentials:", err);
    }
  };

  const handleSaveApiKey = async (testFirst: boolean) => {
    if (!inputApiKey.trim()) return;
    setTestingKey(true);
    setTestResult(null);

    try {
      const res = await fetch("/api/compute/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: selectedProvider,
          apiKey: inputApiKey.trim(),
          testConnection: testFirst,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setTestResult({
          success: true,
          message: `${selectedProvider === "runpod" ? "RunPod" : "Vast.ai"} API key verified and securely stored.`,
        });
        setInputApiKey("");
        loadCredentials();
      } else {
        setTestResult({
          success: false,
          message: data.error || "Authentication failed. Check your API key.",
        });
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: `Connection error: ${err.message}`,
      });
    } finally {
      setTestingKey(false);
    }
  };

  const handleDisconnectKey = async (provider: "runpod" | "vast") => {
    try {
      const res = await fetch("/api/compute/credentials", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const data = await res.json();
      if (data.success) {
        loadCredentials();
        setTestResult(null);
      }
    } catch (err) {
      console.error("Failed to delete credential:", err);
    }
  };

  const loadCatalog = async (provider: "runpod" | "vast") => {
    try {
      const res = await fetch(`/api/compute/cloud/catalog?provider=${provider}`);
      const data = await res.json();
      if (data.success && data.catalog) {
        setGpuCatalog(data.catalog);
      }
    } catch (err) {
      console.error("Failed to load GPU catalog:", err);
    }
  };

  const runCostEstimate = async () => {
    setCalculatingCost(true);
    try {
      const res = await fetch("/api/compute/cloud/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoDurationSeconds: estimateDurationMins * 60,
          targetResolution: estimateResolution,
          provider: selectedProvider,
          gpuId: selectedGpuId,
        }),
      });
      const data = await res.json();
      if (data.success && data.estimate) {
        setCostEstimate(data.estimate);
      }
    } catch (err) {
      console.error("Failed to calculate cost estimate:", err);
    } finally {
      setCalculatingCost(false);
    }
  };

  const loadHardwareDiagnostics = async () => {
    setLoadingHardware(true);
    try {
      const res = await fetch("/api/compute/hardware");
      const data = await res.json();
      if (data.success) {
        setHardwareProfile(data.profile);
        setCapabilityAdvice(data.advice);
        if (data.advice?.recommendedConcurrency) {
          setMaxConcurrency(data.advice.recommendedConcurrency);
        }
      }
    } catch (err) {
      console.error("Failed to detect hardware:", err);
    } finally {
      setLoadingHardware(false);
    }
  };

  const loadInstances = async () => {
    try {
      const res = await fetch("/api/compute/cloud/instances");
      const data = await res.json();
      if (data.success && data.instances) {
        setInstances(data.instances);
      }
    } catch (err) {
      console.error("Failed to load instances:", err);
    }
  };

  const handleProvisionInstance = async () => {
    setProvisioning(true);
    try {
      const res = await fetch("/api/compute/cloud/instances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "provision",
          provider: selectedProvider,
          gpuId: selectedGpuId,
          userApprovedCost: true,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setProvisionConfirmOpen(false);
        loadInstances();
      } else {
        alert(`Provisioning failed: ${data.error}`);
      }
    } catch (err: any) {
      alert(`Provisioning error: ${err.message}`);
    } finally {
      setProvisioning(false);
    }
  };

  const handleTerminateInstance = async (id: string) => {
    if (!confirm("Are you sure you want to terminate this instance? All unpersisted data will be destroyed.")) {
      return;
    }
    try {
      const res = await fetch("/api/compute/cloud/instances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "terminate",
          instanceRecordId: id,
        }),
      });
      const data = await res.json();
      if (data.success) {
        loadInstances();
      }
    } catch (err) {
      console.error("Failed to terminate instance:", err);
    }
  };

  const currentCredential = credentials.find((c) => c.provider === selectedProvider);

  return (
    <div className="flex-1 flex flex-col justify-between min-h-screen bg-cine-dark text-slate-100">
      {/* Top Header */}
      <header className="border-b border-cine-border/60 bg-cine-dark/80 backdrop-blur sticky top-0 z-50 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl electric-gradient flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Film className="w-5 h-5 text-cine-dark stroke-[2.5]" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-wider text-white">
              CINE<span className="electric-text">GEN</span> AI
            </h1>
            <p className="text-xs text-slate-400 font-medium tracking-tight">
              Compute & Hardware Orchestration • Phase 7.1
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <a
            href="/"
            className="px-3 py-1 rounded-full text-xs font-medium bg-cine-panel text-slate-300 border border-cine-border hover:bg-cine-charcoal transition-colors"
          >
            ← Back to Studio
          </a>
          <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-cyan-950 text-cyan-400 border border-cyan-800/60">
            Dual Compute Architecture
          </span>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* Title & Mode Switcher */}
        <div className="space-y-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-white flex items-center space-x-2">
              <Activity className="w-6 h-6 text-cyan-400" />
              <span>Compute Mode Selection</span>
            </h2>
            <p className="text-sm text-slate-400">
              Choose how CINEGEN AI processes neural restoration: leverage your own computer's local resources or connect your personal cloud GPU provider.
            </p>
          </div>

          {/* Mode Switch Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            {/* Mode A: Cloud GPU */}
            <div
              onClick={() => {
                setActiveTab("cloud_gpu");
                saveSettings("cloud_gpu");
              }}
              className={`p-6 rounded-2xl border cursor-pointer transition-all duration-300 relative ${
                activeTab === "cloud_gpu"
                  ? "border-cyan-400 bg-cyan-950/20 ring-1 ring-cyan-400/40 shadow-xl shadow-cyan-950/50"
                  : "border-cine-border bg-cine-charcoal/40 hover:border-slate-600 hover:bg-cine-panel/40"
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-3">
                  <div
                    className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                      activeTab === "cloud_gpu"
                        ? "bg-cyan-500/20 text-cyan-400"
                        : "bg-cine-panel text-slate-400"
                    }`}
                  >
                    <Cloud className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-cyan-400 uppercase tracking-wider">
                      Mode A
                    </div>
                    <h3 className="text-lg font-bold text-white">Cloud GPU Processing</h3>
                  </div>
                </div>
                {activeTab === "cloud_gpu" && (
                  <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-cyan-400 text-cine-dark flex items-center space-x-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Active</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-3">
                Connect your RunPod or Vast.ai account using your own API key. High-speed restoration on RTX 4090 / A100 GPUs with zero subscription markups.
              </p>
              <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-slate-300">
                <span className="px-2 py-0.5 rounded bg-cine-panel border border-cine-border">
                  RunPod & Vast.ai
                </span>
                <span className="px-2 py-0.5 rounded bg-cine-panel border border-cine-border">
                  AES-256-GCM Secure
                </span>
                <span className="px-2 py-0.5 rounded bg-cine-panel border border-cine-border">
                  Auto Teardown
                </span>
              </div>
            </div>

            {/* Mode B: Own PC */}
            <div
              onClick={() => {
                setActiveTab("own_pc");
                saveSettings("own_pc");
              }}
              className={`p-6 rounded-2xl border cursor-pointer transition-all duration-300 relative ${
                activeTab === "own_pc"
                  ? "border-emerald-400 bg-emerald-950/20 ring-1 ring-emerald-400/40 shadow-xl shadow-emerald-950/50"
                  : "border-cine-border bg-cine-charcoal/40 hover:border-slate-600 hover:bg-cine-panel/40"
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-3">
                  <div
                    className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                      activeTab === "own_pc"
                        ? "bg-emerald-500/20 text-emerald-400"
                        : "bg-cine-panel text-slate-400"
                    }`}
                  >
                    <Cpu className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">
                      Mode B
                    </div>
                    <h3 className="text-lg font-bold text-white">Own PC Local Processing</h3>
                  </div>
                </div>
                {activeTab === "own_pc" && (
                  <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-emerald-400 text-cine-dark flex items-center space-x-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Active</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-3">
                Process directly on your computer's CPU or compatible GPU. 100% private, zero cost, with automatic memory protection and concurrency limits.
              </p>
              <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-slate-300">
                <span className="px-2 py-0.5 rounded bg-cine-panel border border-cine-border">
                  100% Offline
                </span>
                <span className="px-2 py-0.5 rounded bg-cine-panel border border-cine-border">
                  Memory Safe
                </span>
                <span className="px-2 py-0.5 rounded bg-cine-panel border border-cine-border">
                  Zero Cost
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Tab Specific Content */}
        {activeTab === "cloud_gpu" ? (
          /* CLOUD GPU SETTINGS VIEW */
          <div className="space-y-8 animate-fadeIn">
            {/* Provider & Credentials Panel */}
            <div className="p-6 rounded-2xl bg-cine-panel/70 border border-cine-border space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-cine-border/80">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center space-x-2">
                    <Key className="w-4 h-4 text-cyan-400" />
                    <span>Cloud GPU Provider & API Key</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Keys are encrypted with AES-256-GCM at rest and never shared or logged.
                  </p>
                </div>

                {/* Provider Selector */}
                <div className="flex items-center space-x-2 bg-cine-charcoal p-1 rounded-xl border border-cine-border">
                  <button
                    onClick={() => {
                      setSelectedProvider("runpod");
                      loadCatalog("runpod");
                      setTestResult(null);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      selectedProvider === "runpod"
                        ? "bg-cyan-500 text-cine-dark"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    RunPod
                  </button>
                  <button
                    onClick={() => {
                      setSelectedProvider("vast");
                      loadCatalog("vast");
                      setTestResult(null);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      selectedProvider === "vast"
                        ? "bg-cyan-500 text-cine-dark"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Vast.ai
                  </button>
                </div>
              </div>

              {/* Current Status of Selected Provider */}
              <div className="flex items-center justify-between p-4 rounded-xl bg-cine-charcoal/60 border border-cine-border/80">
                <div className="flex items-center space-x-3">
                  <Shield className="w-5 h-5 text-cyan-400" />
                  <div>
                    <div className="text-xs text-slate-400">
                      {selectedProvider === "runpod" ? "RunPod" : "Vast.ai"} Connection Status
                    </div>
                    <div className="text-sm font-semibold text-white flex items-center space-x-2">
                      <span>
                        {currentCredential?.isConfigured
                          ? currentCredential.maskedKey
                          : "Not Configured"}
                      </span>
                      {currentCredential?.isConfigured && (
                        <span className="px-2 py-0.5 text-[10px] rounded bg-emerald-950 text-emerald-400 border border-emerald-800/60">
                          Connected
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {currentCredential?.isConfigured && (
                  <button
                    onClick={() => handleDisconnectKey(selectedProvider)}
                    className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-950/30 rounded-lg transition-colors"
                    title="Disconnect and delete API key"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Enter New API Key */}
              <div className="space-y-3">
                <label className="block text-xs font-semibold text-slate-300">
                  {currentCredential?.isConfigured ? "Update API Key" : "Enter API Key"}
                </label>
                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    type="password"
                    value={inputApiKey}
                    onChange={(e) => setInputApiKey(e.target.value)}
                    placeholder={
                      selectedProvider === "runpod"
                        ? "Paste RunPod API Key (rpa_...)"
                        : "Paste Vast.ai API Key"
                    }
                    className="flex-1 px-4 py-2.5 rounded-xl bg-cine-charcoal border border-cine-border focus:border-cyan-400 focus:outline-none text-sm text-white placeholder-slate-500 font-mono"
                  />
                  <button
                    onClick={() => handleSaveApiKey(true)}
                    disabled={testingKey || !inputApiKey.trim()}
                    className="px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-cine-dark font-semibold text-xs transition-colors flex items-center justify-center space-x-2"
                  >
                    {testingKey ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Verifying...</span>
                      </>
                    ) : (
                      <>
                        <Shield className="w-4 h-4" />
                        <span>Test & Connect</span>
                      </>
                    )}
                  </button>
                </div>

                {testResult && (
                  <div
                    className={`p-3 rounded-xl border text-xs flex items-center space-x-2 ${
                      testResult.success
                        ? "bg-emerald-950/40 border-emerald-800/60 text-emerald-300"
                        : "bg-red-950/40 border-red-800/60 text-red-300"
                    }`}
                  >
                    {testResult.success ? (
                      <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 flex-shrink-0" />
                    )}
                    <span>{testResult.message}</span>
                  </div>
                )}
              </div>
            </div>

            {/* GPU Offer Catalog */}
            <div className="p-6 rounded-2xl bg-cine-panel/70 border border-cine-border space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center space-x-2">
                    <Server className="w-4 h-4 text-cyan-400" />
                    <span>Verified GPU Offer Catalog</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Select your preferred GPU hardware for restoration batches.
                  </p>
                </div>
                <button
                  onClick={() => loadCatalog(selectedProvider)}
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg transition-colors"
                  title="Refresh catalog"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {gpuCatalog.map((gpu) => {
                  const rate =
                    selectedProvider === "runpod"
                      ? gpu.hourlyRateRunPodUsd
                      : gpu.hourlyRateVastUsd;
                  const isSelected = selectedGpuId === gpu.id;

                  return (
                    <div
                      key={gpu.id}
                      onClick={() => {
                        setSelectedGpuId(gpu.id);
                        saveSettings();
                      }}
                      className={`p-4 rounded-xl border cursor-pointer transition-all ${
                        isSelected
                          ? "border-cyan-400 bg-cyan-950/30 ring-1 ring-cyan-400"
                          : "border-cine-border bg-cine-charcoal/50 hover:border-slate-600"
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="text-sm font-bold text-white">{gpu.model}</div>
                          <div className="text-xs text-cyan-400 font-semibold mt-0.5">
                            {gpu.vramGb} GB VRAM • {gpu.cudaComputeCapability} Compute
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-extrabold text-emerald-400">
                            ${rate.toFixed(2)}/hr
                          </div>
                          <div className="text-[10px] text-slate-400">typical rate</div>
                        </div>
                      </div>

                      <p className="text-xs text-slate-400 mt-2 line-clamp-2">
                        {gpu.description}
                      </p>

                      <div className="mt-3 pt-3 border-t border-cine-border/60 flex items-center justify-between text-xs">
                        <span className="text-slate-400">
                          Max: <strong className="text-slate-200">{gpu.recommendedMaxResolution}</strong>
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                            isSelected
                              ? "bg-cyan-400 text-cine-dark"
                              : "bg-cine-panel text-slate-400"
                          }`}
                        >
                          {isSelected ? "Selected" : "Select GPU"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Real-Time Cost Estimator Tool */}
            <div className="p-6 rounded-2xl bg-cine-panel/70 border border-cine-border space-y-6">
              <div>
                <h3 className="text-base font-bold text-white flex items-center space-x-2">
                  <DollarSign className="w-4 h-4 text-emerald-400" />
                  <span>Interactive Cost & Time Estimator</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Calculate estimated cloud costs and processing speedup before provisioning.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Inputs */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Video Duration: {estimateDurationMins} minutes ({Math.floor(estimateDurationMins / 60)}h {estimateDurationMins % 60}m)
                    </label>
                    <input
                      type="range"
                      min="5"
                      max="240"
                      step="5"
                      value={estimateDurationMins}
                      onChange={(e) => setEstimateDurationMins(parseInt(e.target.value, 10))}
                      className="w-full accent-cyan-400 cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                      <span>5m (Short)</span>
                      <span>60m (1 Hour)</span>
                      <span>120m (Feature Film)</span>
                      <span>240m (4 Hours)</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Target Restoration Resolution
                    </label>
                    <div className="grid grid-cols-4 gap-2">
                      {(["720p", "1080p", "1440p", "4K"] as const).map((res) => (
                        <button
                          key={res}
                          onClick={() => setEstimateResolution(res)}
                          className={`py-2 rounded-lg text-xs font-bold transition-colors ${
                            estimateResolution === res
                              ? "bg-cyan-500 text-cine-dark"
                              : "bg-cine-charcoal border border-cine-border text-slate-400 hover:text-white"
                          }`}
                        >
                          {res}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Estimate Summary Box */}
                {costEstimate && (
                  <div className="p-5 rounded-xl bg-cine-charcoal/70 border border-cine-border flex flex-col justify-between">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between border-b border-cine-border/80 pb-2">
                        <span className="text-xs text-slate-400">Estimated Cloud GPU Time:</span>
                        <span className="text-sm font-bold text-white">
                          ~{costEstimate.totalEstimatedMinutes} mins
                        </span>
                      </div>
                      <div className="flex items-center justify-between border-b border-cine-border/80 pb-2">
                        <span className="text-xs text-slate-400">GPU Hourly Rate:</span>
                        <span className="text-sm font-bold text-slate-300">
                          ${costEstimate.hourlyRateUsd.toFixed(2)}/hr
                        </span>
                      </div>
                      <div className="flex items-center justify-between border-b border-cine-border/80 pb-2">
                        <span className="text-xs text-slate-400">Estimated Total Cost:</span>
                        <span className="text-lg font-extrabold text-emerald-400">
                          ${costEstimate.typicalCostUsd.toFixed(3)} USD
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Range: ${costEstimate.costRange.minCostUsd.toFixed(2)} – ${costEstimate.costRange.maxCostUsd.toFixed(2)} (includes ~4m container boot buffer)
                      </div>
                    </div>

                    <div className="mt-4 p-3 rounded-lg bg-cine-panel text-[11px] text-cyan-300 border border-cyan-800/40">
                      ⚡ {costEstimate.localCpuComparison.description}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Active Cloud Instances */}
            <div className="p-6 rounded-2xl bg-cine-panel/70 border border-cine-border space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center space-x-2">
                    <Activity className="w-4 h-4 text-cyan-400" />
                    <span>Active Cloud GPU Instances</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Monitor live instances or provision an on-demand worker.
                  </p>
                </div>
                <button
                  onClick={() => setProvisionConfirmOpen(true)}
                  disabled={!currentCredential?.isConfigured}
                  className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-cine-dark font-semibold text-xs transition-colors flex items-center space-x-2"
                >
                  <Zap className="w-4 h-4" />
                  <span>Provision Cloud Worker</span>
                </button>
              </div>

              {instances.length === 0 ? (
                <div className="text-center py-8 text-xs text-slate-500 border border-dashed border-cine-border rounded-xl">
                  No active cloud instances currently provisioned.
                </div>
              ) : (
                <div className="space-y-3">
                  {instances.map((inst) => (
                    <div
                      key={inst.id}
                      className="p-4 rounded-xl bg-cine-charcoal/60 border border-cine-border flex items-center justify-between"
                    >
                      <div>
                        <div className="text-sm font-bold text-white flex items-center space-x-2">
                          <span>{inst.gpuModel}</span>
                          <span
                            className={`px-2 py-0.5 text-[10px] rounded font-semibold ${
                              inst.status === "running"
                                ? "bg-emerald-950 text-emerald-400 border border-emerald-800"
                                : inst.status === "provisioning"
                                ? "bg-amber-950 text-amber-400 border border-amber-800"
                                : "bg-slate-800 text-slate-400"
                            }`}
                          >
                            {inst.status.toUpperCase()}
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 mt-1">
                          ID: {inst.providerInstanceId} • Rate: ${inst.hourlyRateUsd}/hr • Accrued: ${inst.totalCostUsd.toFixed(3)}
                        </div>
                      </div>

                      {inst.status !== "terminated" && (
                        <button
                          onClick={() => handleTerminateInstance(inst.id)}
                          className="px-3 py-1.5 rounded-lg bg-red-950/60 hover:bg-red-900 border border-red-800 text-red-300 text-xs font-semibold transition-colors"
                        >
                          Terminate
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* OWN PC SETTINGS VIEW */
          <div className="space-y-8 animate-fadeIn">
            {/* Live Hardware Diagnostics */}
            <div className="p-6 rounded-2xl bg-cine-panel/70 border border-cine-border space-y-6">
              <div className="flex items-center justify-between pb-4 border-b border-cine-border/80">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center space-x-2">
                    <Cpu className="w-4 h-4 text-emerald-400" />
                    <span>Live Hardware Diagnostics</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Real-time native probe of your processor, memory, and graphics subsystem.
                  </p>
                </div>
                <button
                  onClick={loadHardwareDiagnostics}
                  disabled={loadingHardware}
                  className="p-2 text-slate-400 hover:text-white rounded-lg transition-colors"
                  title="Re-run diagnostic probe"
                >
                  <RefreshCw className={`w-4 h-4 ${loadingHardware ? "animate-spin" : ""}`} />
                </button>
              </div>

              {hardwareProfile && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* CPU Card */}
                  <div className="p-4 rounded-xl bg-cine-charcoal/60 border border-cine-border">
                    <div className="text-xs text-slate-400">Processor (CPU)</div>
                    <div className="text-sm font-bold text-white mt-1 truncate" title={hardwareProfile.cpu.model}>
                      {hardwareProfile.cpu.model}
                    </div>
                    <div className="text-xs text-emerald-400 mt-2 font-semibold">
                      {hardwareProfile.cpu.cores} Physical Cores • {hardwareProfile.cpu.threads} Threads
                    </div>
                  </div>

                  {/* RAM Card */}
                  <div className="p-4 rounded-xl bg-cine-charcoal/60 border border-cine-border">
                    <div className="text-xs text-slate-400">System Memory (RAM)</div>
                    <div className="text-sm font-bold text-white mt-1">
                      {hardwareProfile.memory.totalGb} GB Total
                    </div>
                    <div className="text-xs text-cyan-400 mt-2 font-semibold">
                      {hardwareProfile.memory.freeGb} GB Free ({hardwareProfile.memory.utilizationPercent}% Used)
                    </div>
                  </div>

                  {/* GPU Card */}
                  <div className="p-4 rounded-xl bg-cine-charcoal/60 border border-cine-border">
                    <div className="text-xs text-slate-400">Graphics Device (GPU)</div>
                    <div className="text-sm font-bold text-white mt-1 truncate" title={hardwareProfile.gpu.model}>
                      {hardwareProfile.gpu.model}
                    </div>
                    <div className="text-xs text-purple-400 mt-2 font-semibold">
                      {hardwareProfile.gpu.isDiscrete ? "Discrete GPU" : "Integrated GPU"} • {hardwareProfile.gpu.vramGb} GB VRAM
                    </div>
                  </div>

                  {/* Media Tools */}
                  <div className="p-4 rounded-xl bg-cine-charcoal/60 border border-cine-border">
                    <div className="text-xs text-slate-400">Media Acceleration</div>
                    <div className="text-sm font-bold text-white mt-1">
                      FFmpeg {hardwareProfile.mediaTools.ffmpegVersion || "OK"}
                    </div>
                    <div className="text-xs text-amber-400 mt-2 font-semibold">
                      Inference: {hardwareProfile.inferenceBackend.currentBackend.toUpperCase()}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Local Capability Advisor */}
            {capabilityAdvice && (
              <div className="p-6 rounded-2xl bg-cine-panel/70 border border-cine-border space-y-4">
                <div className="flex items-center space-x-2">
                  <Activity className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-base font-bold text-white">System Capability Advisor</h3>
                </div>

                <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-800/40 space-y-2">
                  <div className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">
                    Assessment Summary
                  </div>
                  <p className="text-sm text-slate-200">{capabilityAdvice.summary}</p>
                  <div className="flex flex-wrap gap-2 pt-2">
                    <span className="px-2.5 py-1 text-xs rounded-md bg-emerald-950 border border-emerald-800 text-emerald-300 font-semibold">
                      Max Quality: {capabilityAdvice.maxRecommendedQuality}
                    </span>
                    <span className="px-2.5 py-1 text-xs rounded-md bg-emerald-950 border border-emerald-800 text-emerald-300 font-semibold">
                      Tier: {capabilityAdvice.performanceTier.toUpperCase()}
                    </span>
                    <span className="px-2.5 py-1 text-xs rounded-md bg-emerald-950 border border-emerald-800 text-emerald-300 font-semibold">
                      Recommended Concurrency: {capabilityAdvice.recommendedConcurrency}
                    </span>
                  </div>
                </div>

                {capabilityAdvice.warnings.length > 0 && (
                  <div className="space-y-2">
                    {capabilityAdvice.warnings.map((w, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-xl bg-amber-950/30 border border-amber-800/50 flex items-start space-x-2 text-xs text-amber-300"
                      >
                        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <span>{w}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Local Tuning Configuration */}
            <div className="p-6 rounded-2xl bg-cine-panel/70 border border-cine-border space-y-4">
              <h3 className="text-base font-bold text-white">Local Resource Controls</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Chunk Execution Concurrency (Current: {maxConcurrency})
                  </label>
                  <p className="text-[11px] text-slate-400 mb-2">
                    Number of video segments processed in parallel. Keep at 1 on CPU systems to prevent CPU starvation.
                  </p>
                  <div className="flex gap-2">
                    {[1, 2, 4].map((c) => (
                      <button
                        key={c}
                        onClick={() => {
                          setMaxConcurrency(c);
                          saveSettings();
                        }}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
                          maxConcurrency === c
                            ? "bg-emerald-500 text-cine-dark"
                            : "bg-cine-charcoal border border-cine-border text-slate-400 hover:text-white"
                        }`}
                      >
                        {c} Worker{c > 1 ? "s" : ""}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Memory Safety Margin (Current: {memorySafetyLimitGb} GB)
                  </label>
                  <p className="text-[11px] text-slate-400 mb-2">
                    Execution automatically throttles batch sizes if free system memory drops below this floor.
                  </p>
                  <div className="flex gap-2">
                    {[1.0, 2.0, 3.0].map((gb) => (
                      <button
                        key={gb}
                        onClick={() => {
                          setMemorySafetyLimitGb(gb);
                          saveSettings();
                        }}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
                          memorySafetyLimitGb === gb
                            ? "bg-emerald-500 text-cine-dark"
                            : "bg-cine-charcoal border border-cine-border text-slate-400 hover:text-white"
                        }`}
                      >
                        {gb} GB
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Provision Confirmation Modal */}
        {provisionConfirmOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="w-full max-w-md p-6 rounded-2xl bg-cine-panel border border-cine-border space-y-4 shadow-2xl">
              <div className="flex items-center space-x-2 text-cyan-400">
                <Shield className="w-5 h-5" />
                <h3 className="text-base font-bold text-white">Confirm Cloud GPU Provisioning</h3>
              </div>
              <p className="text-xs text-slate-300">
                You are about to start a cloud GPU instance on <strong>{selectedProvider === "runpod" ? "RunPod" : "Vast.ai"}</strong> using your personal API key.
              </p>
              <div className="p-3 rounded-xl bg-cine-charcoal border border-cine-border text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-400">GPU Model:</span>
                  <span className="text-white font-semibold">
                    {gpuCatalog.find((g) => g.id === selectedGpuId)?.model || selectedGpuId}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Hourly Rate:</span>
                  <span className="text-emerald-400 font-bold">
                    ${(selectedProvider === "runpod" ? gpuCatalog.find((g) => g.id === selectedGpuId)?.hourlyRateRunPodUsd : gpuCatalog.find((g) => g.id === selectedGpuId)?.hourlyRateVastUsd)?.toFixed(2)} / hour
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Billing:</span>
                  <span className="text-slate-300">Charged directly to your {selectedProvider === "runpod" ? "RunPod" : "Vast.ai"} account</span>
                </div>
              </div>
              <div className="flex justify-end space-x-3 pt-2">
                <button
                  onClick={() => setProvisionConfirmOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleProvisionInstance}
                  disabled={provisioning}
                  className="px-5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-cine-dark font-bold text-xs transition-colors flex items-center space-x-2"
                >
                  {provisioning ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Starting Pod...</span>
                    </>
                  ) : (
                    <span>Confirm & Launch</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-cine-border/60 bg-cine-dark/80 px-6 py-4 text-center text-xs text-slate-500">
        CINEGEN AI • Dual Compute Engine • Pure JavaScript/TypeScript • No Python • No External Inference APIs
      </footer>
    </div>
  );
}
