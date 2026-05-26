import { CodeUnit } from "../parser/types";
import { ProjectRepo } from "../db/project-repo";
import { readFile } from "fs/promises";

export class CodeUnitStore {
  private units: Map<string, CodeUnit> = new Map();
  private byFile: Map<string, CodeUnit[]> = new Map();
  private byName: Map<string, CodeUnit[]> = new Map();
  private projectId: string | null = null;

  private populate(list: CodeUnit[]): void {
    this.units.clear();
    this.byFile.clear();
    this.byName.clear();

    for (const unit of list) {
      this.units.set(unit.id, unit);

      const fileList = this.byFile.get(unit.filePath);
      if (fileList) {
        fileList.push(unit);
      } else {
        this.byFile.set(unit.filePath, [unit]);
      }

      const nameList = this.byName.get(unit.name);
      if (nameList) {
        nameList.push(unit);
      } else {
        this.byName.set(unit.name, [unit]);
      }
    }
  }

  async loadFromDb(projectId: string, repo: ProjectRepo): Promise<void> {
    this.projectId = projectId;
    const units = repo.getCodeUnitsByProject(projectId);
    this.populate(units);
  }

  async load(jsonPath: string): Promise<void> {
    const raw = await readFile(jsonPath, "utf-8");
    const list: CodeUnit[] = JSON.parse(raw);
    this.populate(list);
  }

  async loadFromUnits(units: CodeUnit[]): Promise<void> {
    this.projectId = null;
    this.populate(units);
  }

  getUnit(id: string): CodeUnit | undefined {
    return this.units.get(id);
  }

  getUnitsByFile(filePath: string): CodeUnit[] {
    return this.byFile.get(filePath) || [];
  }

  getUnitsByName(name: string): CodeUnit[] {
    return this.byName.get(name) || [];
  }

  getMethodsOfClass(className: string, filePath?: string): CodeUnit[] {
    return Array.from(this.units.values()).filter(
      (u) => u.kind === "method" && u.parentName === className && (!filePath || u.filePath === filePath),
    );
  }

  getAllUnits(): CodeUnit[] {
    return Array.from(this.units.values());
  }

  get size(): number {
    return this.units.size;
  }
}
