import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import { createPortal } from "react-dom";
import { useSettingsStore } from "../../stores/settings-store";
import { getPreset, normalizeExtraModels } from "@shared/platform-presets";
import type { ProviderConfig, ExtraModelCapability } from "@shared/platform-presets";
impor