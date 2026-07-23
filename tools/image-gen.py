#!/usr/bin/env python3
"""Run the bundled image CLI with the active Codex provider configuration."""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tomllib


class ConfigError(RuntimeError):
    pass


def codex_home() -> Path:
    configured = os.environ.get("CODEX_HOME")
    return Path(configured).expanduser() if configured else Path.home() / ".codex"


def load_provider(codex_dir: Path) -> tuple[str, str, str, str]:
    config_path = codex_dir / "config.toml"
    auth_path = codex_dir / "auth.json"

    try:
        with config_path.open("rb") as config_file:
            config = tomllib.load(config_file)
    except FileNotFoundError as exc:
        raise ConfigError(f"Codex config not found: {config_path}") from exc
    except tomllib.TOMLDecodeError as exc:
        raise ConfigError(f"Invalid Codex config: {exc}") from exc

    provider_name = config.get("model_provider")
    if not isinstance(provider_name, str) or not provider_name:
        raise ConfigError("Codex config does not define model_provider.")

    providers = config.get("model_providers", {})
    provider = providers.get(provider_name, {}) if isinstance(providers, dict) else {}
    base_url = provider.get("base_url") if isinstance(provider, dict) else None
    if not isinstance(base_url, str) or not base_url:
        raise ConfigError(
            f"Codex provider '{provider_name}' does not define base_url."
        )

    image_model = config.get("vision_model", "gpt-image-2")
    if not isinstance(image_model, str) or not image_model.startswith("gpt-image-"):
        raise ConfigError("Codex config vision_model must be a GPT Image model.")

    try:
        auth = json.loads(auth_path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ConfigError(f"Codex auth file not found: {auth_path}") from exc
    except json.JSONDecodeError as exc:
        raise ConfigError(f"Invalid Codex auth file: {exc}") from exc

    api_key = auth.get("OPENAI_API_KEY") if isinstance(auth, dict) else None
    if not isinstance(api_key, str) or not api_key:
        raise ConfigError("Codex auth file does not contain OPENAI_API_KEY.")

    return provider_name, base_url.rstrip("/"), api_key, image_model


def main(argv: list[str]) -> int:
    codex_dir = codex_home()

    try:
        provider_name, base_url, api_key, image_model = load_provider(codex_dir)
    except ConfigError as exc:
        print(f"image-gen: {exc}", file=sys.stderr)
        return 2

    image_cli = codex_dir / "skills" / ".system" / "imagegen" / "scripts" / "image_gen.py"
    if not image_cli.is_file():
        print(f"image-gen: bundled image CLI not found: {image_cli}", file=sys.stderr)
        return 2

    if argv == ["--config-check"]:
        print(f"provider={provider_name}")
        print(f"base_url={base_url}")
        print(f"image_model={image_model}")
        print("api_key=present")
        print(f"image_cli={image_cli}")
        return 0

    if not argv:
        print(
            "Usage: python tools/image-gen.py <generate|edit|generate-batch> [options]",
            file=sys.stderr,
        )
        print("       python tools/image-gen.py --config-check", file=sys.stderr)
        return 2

    command = list(argv)
    if command[0] in {"generate", "edit", "generate-batch"} and "--model" not in command:
        command[1:1] = ["--model", image_model]

    child_env = os.environ.copy()
    child_env["OPENAI_API_KEY"] = api_key
    child_env["OPENAI_BASE_URL"] = base_url

    print(f"Using Codex provider '{provider_name}' at {base_url}.", file=sys.stderr)
    completed = subprocess.run(
        [sys.executable, str(image_cli), *command],
        env=child_env,
        check=False,
    )
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
