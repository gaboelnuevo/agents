import type { SkillDefinition } from "./types.js";
import { registerSkillDefinition } from "./registry.js";

export class Skill {
  static async define(def: SkillDefinition): Promise<void> {
    registerSkillDefinition(def);
  }
}
