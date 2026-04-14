OpenClaw / AgentSkills packs for this runtime.

Put one folder per skill here; each folder should contain a SKILL.md (see packages/skill-loader-openclaw and examples/load-openclaw-skills).

OpenClaw is on by default (`enabled: true`, `skillsDirs: [./skills]` relative to the stack file). Override in YAML if needed.

Docker image: the Dockerfile copies this folder to /app/apps/runtime/config/skills so skillsDirs: [./skills] works
without a bind mount (only readme.txt unless you add SKILL.md packs to the repo).

Docker Compose (docker-compose-with-redis.yml): the same path is overridden by a read-only mount of host apps/runtime/skills.

In config/docker.stack.yaml use:

  openclaw:
    enabled: true
    skillsDirs:
      - ./skills

Host run with config/local.yaml under config/: point at this folder with ../skills, e.g.

  skillsDirs:
    - ../skills

This folder is not gitignored; add only sample or team-shared skills you are OK committing, or point skillsDirs at a path outside the repo for private skills.
