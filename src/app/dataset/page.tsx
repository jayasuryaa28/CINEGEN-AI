"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  Database,
  ArrowLeft,
  RefreshCw,
  PlusCircle,
  CheckCircle,
  AlertTriangle,
  Play,
  Volume2,
  Sliders,
  ShieldCheck,
  FileText,
} from "lucide-react";
import { DatasetManifest, DegradationProfile, QualityValidationReport } from "@/types/dataset";

export default function DatasetStudioPage() {
  const [manifest, setManifest] = useState<DatasetManifest | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [profiles, setProfiles] = useState<DegradationProfile[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [validationReport, setValidationReport] = useState<QualityValidationReport | null>(null);
  const [generating, setGenerating] = useState<boolean>(false);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("auditorium_rear_center");
  const [activeMediaPreview, setActiveMediaPreview] = useState<{
    cleanVideo: string;
    degradedVideo: string;
    cleanAudio: string;
    degradedAudio: string;
    pairId: string;
  } | null>(null);

  const fetchDataset = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/dataset");
      const data = await res.json();
      if (data.success) {
        setManifest(data.manifest);
        setStats(data.stats);
        setProfiles(data.availableProfiles);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDataset();
  }, []);

  const handleValidate = async () => {
    try {
      const res = await fetch("/api/dataset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "validate" }),
      });
      const data = await res.json();
      if (data.success) {
        setValidationReport(data.report);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleGeneratePair = async (sourceId: string) => {
    setGenerating(true);
    try {
      const res = await fetch("/api/dataset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate_pair",
          sourceId,
          profileId: selectedProfileId,
        }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchDataset();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-cine-dark text-slate-100 flex flex-col">
      {/* Header */}
      <header className="border-b border-cine-border/60 bg-cine-dark/80 backdrop-blur sticky top-0 z-50 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Link
            href="/"
            className="p-2 rounded-xl bg-cine-panel border border-cine-border text-slate-300 hover:text-white hover:border-cyan-400 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-lg font-bold tracking-wider text-white flex items-center space-x-2">
              <Database className="w-5 h-5 text-cyan-400" />
              <span>CINEGEN DATASET STUDIO (PHASE 2)</span>
            </h1>
            <p className="text-xs text-slate-400">
              Synthetic Theatre Degradation Engine & Paired Dataset Management
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={handleValidate}
            className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-cine-panel border border-cine-border text-slate-200 hover:border-cyan-400 transition-colors flex items-center space-x-1.5"
          >
            <ShieldCheck className="w-4 h-4 text-cyan-400" />
            <span>Validate Integrity</span>
          </button>
          <button
            onClick={fetchDataset}
            className="p-2 rounded-lg bg-cine-panel border border-cine-border text-slate-300 hover:text-white"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* Statistics Cards */}
        {stats && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="cine-glass p-5 rounded-2xl border border-cine-border">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                Total Paired Samples
              </div>
              <div className="text-3xl font-bold text-white font-mono">{stats.totalPairs}</div>
              <div className="text-[11px] text-cyan-400 mt-1">Clean & Degraded Pairs</div>
            </div>

            <div className="cine-glass p-5 rounded-2xl border border-cine-border">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                Split Distribution
              </div>
              <div className="text-sm font-mono text-slate-200 mt-1 space-y-0.5">
                <div className="flex justify-between">
                  <span>Train:</span>
                  <span className="text-emerald-400 font-bold">{stats.splits.train}</span>
                </div>
                <div className="flex justify-between">
                  <span>Val:</span>
                  <span className="text-amber-400 font-bold">{stats.splits.val}</span>
                </div>
                <div className="flex justify-between">
                  <span>Test:</span>
                  <span className="text-cyan-400 font-bold">{stats.splits.test}</span>
                </div>
              </div>
            </div>

            <div className="cine-glass p-5 rounded-2xl border border-cine-border">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                Authorized Sources
              </div>
              <div className="text-3xl font-bold text-white font-mono">{stats.totalSources}</div>
              <div className="text-[11px] text-slate-400 mt-1">Zero Data Leakage Protocol</div>
            </div>

            <div className="cine-glass p-5 rounded-2xl border border-cine-border">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                License Status
              </div>
              <div className="text-sm font-semibold text-emerald-400 mt-2 truncate">
                {stats.license}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">Public Domain / CC0 Verified</div>
            </div>
          </div>
        )}

        {/* Validation Report Banner */}
        {validationReport && (
          <div
            className={`p-4 rounded-xl border flex items-start space-x-3 text-sm ${
              validationReport.passed
                ? "bg-emerald-950/40 border-emerald-800 text-emerald-300"
                : "bg-red-950/40 border-red-800 text-red-300"
            }`}
          >
            {validationReport.passed ? (
              <CheckCircle className="w-5 h-5 flex-shrink-0 text-emerald-400 mt-0.5" />
            ) : (
              <AlertTriangle className="w-5 h-5 flex-shrink-0 text-red-400 mt-0.5" />
            )}
            <div>
              <div className="font-bold">
                {validationReport.passed
                  ? `All ${validationReport.totalChecked} sample pairs passed automated media and timestamp validation!`
                  : `Validation failed with ${validationReport.errors.length} errors.`}
              </div>
              {!validationReport.passed && (
                <ul className="mt-2 list-disc list-inside text-xs space-y-1">
                  {validationReport.errors.map((e, idx) => (
                    <li key={idx}>
                      [{e.type}] Pair {e.pairId}: {e.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* Source Video Generation Panel */}
        <div className="cine-glass rounded-2xl p-6 border border-cine-border space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-white flex items-center space-x-2">
                <Sliders className="w-5 h-5 text-cyan-400" />
                <span>Synthetic Degradation Generator</span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Apply physical theatre degradation models to authorized clean sources.
              </p>
            </div>

            <div className="flex items-center space-x-3 w-full sm:w-auto">
              <select
                value={selectedProfileId}
                onChange={(e) => setSelectedProfileId(e.target.value)}
                className="bg-cine-panel border border-cine-border text-white text-xs rounded-xl px-3 py-2 focus:outline-none focus:border-cyan-400 cursor-pointer"
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {manifest && manifest.sources.length > 0 ? (
            <div className="border border-cine-border/60 rounded-xl overflow-hidden divide-y divide-cine-border/40">
              {manifest.sources.map((src) => (
                <div
                  key={src.sourceId}
                  className="p-4 bg-cine-panel/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                >
                  <div>
                    <div className="text-sm font-semibold text-white flex items-center space-x-2">
                      <span>{src.filename}</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-cine-dark border border-cine-border text-cyan-400">
                        {src.assignedSplit}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      Source ID: {src.sourceId} • Duration: {src.duration.toFixed(1)}s • License:{" "}
                      {src.license}
                    </div>
                  </div>

                  <button
                    onClick={() => handleGeneratePair(src.sourceId)}
                    disabled={generating}
                    className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider electric-gradient text-cine-dark hover:brightness-110 active:scale-95 disabled:opacity-50 transition-all flex items-center space-x-1.5"
                  >
                    <PlusCircle className="w-4 h-4 stroke-[2.5]" />
                    <span>Generate Degraded Pair</span>
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center text-slate-400 text-xs border border-dashed border-cine-border rounded-xl">
              No sources registered yet. Run the pipeline import script to register authorized media.
            </div>
          )}
        </div>

        {/* Side-by-Side Media Comparison Viewer */}
        {activeMediaPreview && (
          <div className="cine-glass rounded-2xl p-6 border border-cyan-500/30 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                <Play className="w-4 h-4 text-cyan-400" />
                <span>Side-by-Side Sample Comparison (Pair: {activeMediaPreview.pairId})</span>
              </h3>
              <button
                onClick={() => setActiveMediaPreview(null)}
                className="text-xs text-slate-400 hover:text-white"
              >
                Close
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Clean Reference */}
              <div className="space-y-2">
                <div className="text-xs font-semibold text-emerald-400 uppercase tracking-wider flex items-center justify-between">
                  <span>Clean Ground Truth Target</span>
                  <span className="text-[10px] text-slate-400">Pristine 1080p + 48kHz WAV</span>
                </div>
                <video
                  src={`/api/dataset/media?file=${encodeURIComponent(activeMediaPreview.cleanVideo)}`}
                  controls
                  className="w-full max-h-[280px] bg-black rounded-xl border border-emerald-900/60 object-contain"
                />
              </div>

              {/* Synthetically Degraded Sample */}
              <div className="space-y-2">
                <div className="text-xs font-semibold text-amber-400 uppercase tracking-wider flex items-center justify-between">
                  <span>Synthetically Degraded Sample</span>
                  <span className="text-[10px] text-slate-400">Keystone, Shake, Crowd Murmur</span>
                </div>
                <video
                  src={`/api/dataset/media?file=${encodeURIComponent(activeMediaPreview.degradedVideo)}`}
                  controls
                  className="w-full max-h-[280px] bg-black rounded-xl border border-amber-900/60 object-contain"
                />
              </div>
            </div>
          </div>
        )}

        {/* Dataset Samples Table */}
        <div className="cine-glass rounded-2xl p-6 border border-cine-border space-y-4">
          <h2 className="text-base font-bold text-white flex items-center space-x-2">
            <FileText className="w-5 h-5 text-cyan-400" />
            <span>Paired Dataset Samples</span>
          </h2>

          {manifest && manifest.samples.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-cine-border/60 text-slate-400 uppercase font-mono">
                    <th className="py-3 px-3">Pair ID</th>
                    <th className="py-3 px-3">Split</th>
                    <th className="py-3 px-3">Degradation Profile</th>
                    <th className="py-3 px-3">Degraded Res</th>
                    <th className="py-3 px-3">Clean Target Res</th>
                    <th className="py-3 px-3 text-right">Inspect</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cine-border/30">
                  {manifest.samples.map((s) => (
                    <tr key={s.pairId} className="hover:bg-cine-panel/30 transition-colors">
                      <td className="py-3 px-3 font-mono text-cyan-300">{s.pairId}</td>
                      <td className="py-3 px-3">
                        <span
                          className={`px-2 py-0.5 rounded font-mono uppercase text-[10px] ${
                            s.split === "train"
                              ? "bg-emerald-950/60 text-emerald-400 border border-emerald-800"
                              : s.split === "val"
                              ? "bg-amber-950/60 text-amber-400 border border-amber-800"
                              : "bg-cyan-950/60 text-cyan-400 border border-cyan-800"
                          }`}
                        >
                          {s.split}
                        </span>
                      </td>
                      <td className="py-3 px-3 font-medium text-slate-200">
                        {s.degradationProfileApplied.name}
                      </td>
                      <td className="py-3 px-3 font-mono text-slate-400">
                        {s.degradedSample.width}x{s.degradedSample.height} @{" "}
                        {s.degradedSample.framerate}fps
                      </td>
                      <td className="py-3 px-3 font-mono text-slate-400">
                        {s.cleanTarget.width}x{s.cleanTarget.height} @ {s.cleanTarget.framerate}fps
                      </td>
                      <td className="py-3 px-3 text-right">
                        <button
                          onClick={() =>
                            setActiveMediaPreview({
                              cleanVideo: s.cleanTarget.videoPath,
                              degradedVideo: s.degradedSample.videoPath,
                              cleanAudio: s.cleanTarget.audioPath,
                              degradedAudio: s.degradedSample.audioPath,
                              pairId: s.pairId,
                            })
                          }
                          className="px-2.5 py-1 rounded bg-cine-panel border border-cine-border text-slate-300 hover:text-white hover:border-cyan-400 transition-colors"
                        >
                          Compare
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-8 text-center text-slate-400 text-xs border border-dashed border-cine-border rounded-xl">
              No samples created yet. Select a source and click Generate Degraded Pair above.
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
