import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { isUiLanguage } from "@shared/i18n/locale";
import { useSettingsStore } from "../../stores/settings-store";
import { Select } from "../Select";
import "../../lib/i18n";

export function LanguageSelector(): JSX.Element {
  const { t } = useTranslation();
  const id = useId();
  const language = useSettingsStore((state) => state.uiLanguage);
  const setLanguage = useSettingsStore((state) => state.setUiLanguage);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-text-secondary mb-2">
        {t("settings.language")}
      </label>
      <Select
        id={id}
        block
        value={language}
        disabled={saving}
        aria-describedby={failed ? `${id}-error` : undefined}
        onChange={async (value) => {
          if (!isUiLanguage(value)) return;
          setSaving(true);
          setFailed(false);
          try {
            await setLanguage(value);
          } catch {
            setFailed(true);
          } finally {
            setSaving(false);
          }
        }}
        options={[
          { value: "system", label: t("settings.followSystem") },
          { value: "zh-CN", label: "简体中文" },
          { value: "en", label: "English" },
        ]}
      />
      {failed && <p id={`${id}-error`} role="alert" className="text-xs text-danger mt-1">{t("settings.languageSaveFailed")}</p>}
    </div>
  );
}
