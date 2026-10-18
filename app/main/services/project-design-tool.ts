import { readProjectDesign, saveProjectDesign } from "./project-design";
import { STYLE_PRESETS } from "../../shared/visual-design/presets";
import { BRAND_REFERENCES, visualSpecPrompt } from "../../shared/visual-design/spec";
import { getDefineToolFn, type ToolDefinition } from "./pi-sdk";
export async function createProjectDesignTool(projectPath?: string): Promise<ToolDefinition> {
    const defineTool = await getDefineToolFn();
    return defineTool({
        name: "set_project_design", label: "调整项目设计", description: "读取或更新本项目的版本化视觉规范与实际样式包。更新后主会话/设计/实现必须复用该包，不另写一套主题。只修改受管理且未被用户编辑的文件；冲突会拒绝覆盖。浏览品牌原始资料仍用brand-tokens skill；仅可预览的品牌可作为brandId。",
        parameters: { type: "object", properties: {
                styleId: { type: "string", enum: STYLE_PRESETS.map(style=>style.id) },
                palette: { type: "string", enum: ["default", "mono", "coral", "green", "violet"] }, effect: { type: "string", enum: ["subtle", "standard"] },
                layout: { type: "string", enum: ["dashboard", "landing", "form", "detail"] }, brandId: { type: "string", enum: ["", ...BRAND_REFERENCES.filter(brand => brand.quality !== "reference").map(brand => brand.id)], description: "可预览品牌ID；空串清除品牌参考。无参数时仅返回当前视觉规范路径和配置。" },
            } },
        async execute(_id: string, input: any) {
            if (!projectPath)
                throw new Error("当前无项目路径");
            const existing = readProjectDesign(projectPath);
            const selection = { ...existing?.selection, ...input };
            if (input.styleId !== undefined && input.styleId !== existing?.selection.styleId) selection.brief = "";
            if (input.palette !== undefined && input.palette !== existing?.selection.palette && input.brandId === undefined) selection.brandId = "";
            if (input.brandId && input.palette === undefined) selection.palette = "default";
            const spec = Object.keys(input).length ? saveProjectDesign(projectPath, selection) : existing;
            return { content: [{ type: "text" as const, text: spec ? visualSpecPrompt(spec) : "当前项目没有结构化视觉规范。可选择风格建立规范，既有用户文件不会被覆盖。" }], details: {} };
        },
    } as any) as ToolDefinition;
}
