package em.lens

import android.content.Context
import android.graphics.Shader
import android.graphics.Canvas
import android.graphics.RenderNode
import android.graphics.Color
import android.graphics.PorterDuff
import android.view.View
import android.graphics.RenderEffect
import android.graphics.RuntimeShader
import android.os.Build
import androidx.annotation.RequiresApi
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.views.ExpoView

class LensModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MintLens")
    View(LensView::class) {
      Prop("targetTag") { view: LensView, tag: Int? -> view.targetTag = tag }
      Prop("radius") { view: LensView, radius: Float -> view.setRadiusDp(radius) }
    }
  }
}

class LensView(context: Context, private val lensAppContext: AppContext) : ExpoView(context, lensAppContext) {
  var targetTag: Int? = null
    set(value) { field = value; invalidate() }
  private var configuredWidth = 0
  private var configuredHeight = 0
  private var configuredRadius = -1f
  private var cornerDp = 0f
  private val targetLocation = IntArray(2)
  private val ownLocation = IntArray(2)
  private var sourceNode: RenderNode? = null

  init { setWillNotDraw(false) }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    if (Build.VERSION.SDK_INT < 33 || !canvas.isHardwareAccelerated || width == 0 || height == 0) return
    val target = targetTag?.let { rootView.findViewById<View>(it)
      ?: lensAppContext.currentActivity?.findViewById<View>(it) } ?: return
    if (target === this) return
    val node = sourceNode ?: RenderNode("MintLensBackdrop").also { sourceNode = it }
    target.getLocationOnScreen(targetLocation)
    getLocationOnScreen(ownLocation)
    // Keep pixels beyond the glass silhouette available to the curved rim.
    val padding = (26 * resources.displayMetrics.density).toInt()
    node.setPosition(-padding, -padding, width + padding, height + padding)
    val recording = node.beginRecording(width + padding * 2, height + padding * 2)
    try {
      recording.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)
      recording.translate((targetLocation[0] - ownLocation[0] + padding).toFloat(), (targetLocation[1] - ownLocation[1] + padding).toFloat())
      target.draw(recording)
    } finally {
      node.endRecording()
    }
    if (configuredWidth != width || configuredHeight != height || configuredRadius != cornerDp) {
      Optics.applyToNode(node, width, height, cornerDp * resources.displayMetrics.density, resources.displayMetrics.density, context)
      configuredWidth = width
      configuredHeight = height
      configuredRadius = cornerDp
    }
    // The enlarged sampling buffer must never paint outside the actual surface.
    canvas.save()
    canvas.clipRect(0, 0, width, height)
    canvas.drawRenderNode(node)
    canvas.restore()
    postInvalidateDelayed(33)
  }

  override fun onDetachedFromWindow() {
    sourceNode?.discardDisplayList()
    sourceNode = null
    configuredWidth = 0
    super.onDetachedFromWindow()
  }
  fun setRadiusDp(value: Float) {
    cornerDp = value
    refreshLens()
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    refreshLens()
  }

  private fun refreshLens() { invalidate() }

}

@RequiresApi(33)
private object Optics {
  // Only the backdrop layer is sampled. Text and touch targets are siblings above it.
  private var source: String? = null
  private var preset: org.json.JSONObject? = null
  fun applyToNode(node: RenderNode, width: Int, height: Int, radius: Float, dp: Float, context: Context) {
    val materialSource = source ?: context.assets.open("em-liquid-material.agsl")
      .bufferedReader().use { it.readText() }.also { source = it }
    val parameters = preset ?: org.json.JSONObject(context.assets.open("em-liquid-app.json")
      .bufferedReader().use { it.readText() }).getJSONObject("parameters").also { preset = it }
    val shader = RuntimeShader(materialSource)
    shader.setFloatUniform("pixelScale", dp)
    shader.setFloatUniform("padding", (26 * dp).toInt().toFloat())
    shader.setFloatUniform("size", width.toFloat(), height.toFloat())
    shader.setFloatUniform("radius", radius.coerceAtMost(minOf(width, height) / 2f))
    val bevelWidth = height * parameters.getDouble("bevelRatio").toFloat()
    shader.setFloatUniform("bevel", bevelWidth)
    shader.setFloatUniform("refractionWidth", bevelWidth * parameters.getDouble("width").toFloat())
    val uniformNames = listOf(
      "heightRatio",
      "normalStep",
      "sideWidth",
      "sideRim",
      "sideTravel",
      "travel",
      "rimStrength",
      "rimRange",
      "faceScale",
      "dispersion",
      "rimDispersion",
      "darkEdge",
      "brightEdge",
      "edgeCenter",
      "edgeWidth",
      "ior",
      "adaptation",
      "environmentMix",
    )
    for (name in uniformNames) {
      shader.setFloatUniform("u_" + name, parameters.getDouble(name).toFloat())
    }
    val lens = RenderEffect.createRuntimeShaderEffect(shader, "backdrop")
    val blurRadius = if (radius < 1f) 8 * dp else parameters.getDouble("blur").toFloat() * dp
    val blur = RenderEffect.createBlurEffect(blurRadius, blurRadius, Shader.TileMode.CLAMP)
    node.setRenderEffect(RenderEffect.createChainEffect(lens, blur))
  }
}
