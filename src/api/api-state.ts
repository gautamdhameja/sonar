import { ProjectRepo } from "../db/project-repo";
import { CodeUnitStore } from "../retriever/unit-store";

export class ApiState {
  readonly repo: ProjectRepo;
  readonly stores = new Map<string, CodeUnitStore>();
  private currentProjectId: string | null = null;

  constructor(repo = new ProjectRepo()) {
    this.repo = repo;
  }

  getCurrentProjectId(): string | null {
    return this.currentProjectId;
  }

  setCurrentProjectId(projectId: string | null): void {
    this.currentProjectId = projectId;
  }

  async getStore(projectId: string): Promise<CodeUnitStore | null> {
    const project = this.repo.getProject(projectId);
    if (!project) return null;
    const existing = this.stores.get(projectId);
    if (existing) return existing;

    const store = new CodeUnitStore();
    await store.loadFromDb(projectId, this.repo);
    this.stores.set(projectId, store);
    return store;
  }

  deleteProjectCache(projectId: string): void {
    this.stores.delete(projectId);
    if (this.currentProjectId === projectId) {
      this.currentProjectId = null;
    }
  }
}
