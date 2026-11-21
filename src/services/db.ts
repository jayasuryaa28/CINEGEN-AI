import fs from "fs";
import path from "path";
import { ProcessingJob } from "@/types";

export interface IJobRepository {
  create(job: ProcessingJob): Promise<ProcessingJob>;
  findById(id: string): Promise<ProcessingJob | null>;
  update(id: string, updates: Partial<ProcessingJob>): Promise<ProcessingJob | null>;
  listRecent(limit?: number): Promise<ProcessingJob[]>;
}

export class JsonJobRepository implements IJobRepository {
  private dbFile: string;
  private jobs: Map<string, ProcessingJob> = new Map();

  constructor() {
    const dir = path.resolve(process.env.STORAGE_LOCAL_DIR || "./storage_data");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.dbFile = path.join(dir, "jobs_store.json");
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(this.dbFile)) {
        const raw = fs.readFileSync(this.dbFile, "utf-8");
        const list: ProcessingJob[] = JSON.parse(raw);
        for (const j of list) {
          this.jobs.set(j.id, j);
        }
      }
    } catch (e) {
      console.warn("Could not load jobs store, initializing empty:", e);
    }
  }

  private persist() {
    try {
      const arr = Array.from(this.jobs.values());
      fs.writeFileSync(this.dbFile, JSON.stringify(arr, null, 2), "utf-8");
    } catch (e) {
      console.error("Failed to persist jobs store:", e);
    }
  }

  public async create(job: ProcessingJob): Promise<ProcessingJob> {
    this.jobs.set(job.id, job);
    this.persist();
    return job;
  }

  public async findById(id: string): Promise<ProcessingJob | null> {
    return this.jobs.get(id) || null;
  }

  public async update(id: string, updates: Partial<ProcessingJob>): Promise<ProcessingJob | null> {
    const existing = this.jobs.get(id);
    if (!existing) return null;

    const updated: ProcessingJob = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    this.jobs.set(id, updated);
    this.persist();
    return updated;
  }

  public async listRecent(limit: number = 20): Promise<ProcessingJob[]> {
    const all = Array.from(this.jobs.values());
    all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return all.slice(0, limit);
  }
}

export const jobRepository = new JsonJobRepository();
