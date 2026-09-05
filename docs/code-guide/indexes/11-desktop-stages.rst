11. Desktop — stages (geology, litho, geotech, parameters, export, 3D)
======================================================================

.. CG-EXPLANATION-START id=intro

Besides Sections, the app has a stage for each step of the workflow, and each
one lives in its own folder under ``shell/stages/``. This group collects them
all: the **data** stage (import and browse CPTs and boreholes), the **geology**
stage (formations and surfaces, plus the 3-D viewers), the **lithology** stage
(the assisted-manual layer segmenter), the **geotech** stage (subdivision into
NAD packing classes), the **parameters** stage (per-unit statistics and the NAD
lookup), and the **export** stage (writing files for design tools).

Each stage is a self-contained screen: its own canvas, toolbar, inspector and
supporting helpers. They all plug into the same shell frame from group 9 and
talk to the engine through the API clients in group 12.

.. CG-EXPLANATION-END id=intro

.. toctree::
   :maxdepth: 1

   ../pages/desktop.renderer.src.shell.stages.data.DataCanvas
   ../pages/desktop.renderer.src.shell.stages.data.DataInspector
   ../pages/desktop.renderer.src.shell.stages.data.DataStage
   ../pages/desktop.renderer.src.shell.stages.data.DataToolbar
   ../pages/desktop.renderer.src.shell.stages.data.dataInspectorVirtualList
   ../pages/desktop.renderer.src.shell.stages.export.ExportCanvas
   ../pages/desktop.renderer.src.shell.stages.export.ExportStage
   ../pages/desktop.renderer.src.shell.stages.geology.BasemapPanel
   ../pages/desktop.renderer.src.shell.stages.geology.CesiumViewport
   ../pages/desktop.renderer.src.shell.stages.geology.FormationSelectionDialog
   ../pages/desktop.renderer.src.shell.stages.geology.Geology3DViewer
   ../pages/desktop.renderer.src.shell.stages.geology.GeologyBoreholesInModel
   ../pages/desktop.renderer.src.shell.stages.geology.GeologyCanvas
   ../pages/desktop.renderer.src.shell.stages.geology.GeologyConfidenceFadeToggle
   ../pages/desktop.renderer.src.shell.stages.geology.GeologyCrossingsBanner
   ../pages/desktop.renderer.src.shell.stages.geology.GeologyFormationList
   ../pages/desktop.renderer.src.shell.stages.geology.GeologyInspector
   ../pages/desktop.renderer.src.shell.stages.geology.GeologyInspectorHeader
   ../pages/desktop.renderer.src.shell.stages.geology.GeologyStage
   ../pages/desktop.renderer.src.shell.stages.geology.GeologyToolbar
   ../pages/desktop.renderer.src.shell.stages.geology.GeotechLayersTree
   ../pages/desktop.renderer.src.shell.stages.geology.cesiumGeometry
   ../pages/desktop.renderer.src.shell.stages.geology.footprintRingPrimitive
   ../pages/desktop.renderer.src.shell.stages.geology.geology3DPrimitives
   ../pages/desktop.renderer.src.shell.stages.geology.geologyEmptyState
   ../pages/desktop.renderer.src.shell.stages.geology.groundSurfaceLayer
   ../pages/desktop.renderer.src.shell.stages.geology.reorderFormationsCommand
   ../pages/desktop.renderer.src.shell.stages.geology.sceneRender
   ../pages/desktop.renderer.src.shell.stages.geology.useCameraLink
   ../pages/desktop.renderer.src.shell.stages.geology.useGeologyFormations
   ../pages/desktop.renderer.src.shell.stages.geology.useViewportZoomTuning
   ../pages/desktop.renderer.src.shell.stages.geotechnical.GeotechAdmixtureChoiceDialog
   ../pages/desktop.renderer.src.shell.stages.geotechnical.GeotechBuildPreflightDialog
   ../pages/desktop.renderer.src.shell.stages.geotechnical.GeotechBuildReportBanner
   ../pages/desktop.renderer.src.shell.stages.geotechnical.GeotechnicalCanvas
   ../pages/desktop.renderer.src.shell.stages.geotechnical.GeotechnicalInspector
   ../pages/desktop.renderer.src.shell.stages.geotechnical.GeotechnicalStage
   ../pages/desktop.renderer.src.shell.stages.geotechnical.GeotechnicalToolbar
   ../pages/desktop.renderer.src.shell.stages.geotechnical.GeotechnicalUnitRoster
   ../pages/desktop.renderer.src.shell.stages.geotechnical.geotechBadges
   ../pages/desktop.renderer.src.shell.stages.geotechnical.geotechRosterRows
   ../pages/desktop.renderer.src.shell.stages.geotechnical.geotechUnitTree
   ../pages/desktop.renderer.src.shell.stages.geotechnical.useGeotechBuildPreflight
   ../pages/desktop.renderer.src.shell.stages.geotechnical.useGeotechBuildPreflight_constants
   ../pages/desktop.renderer.src.shell.stages.lithology.ConfirmParentDialog
   ../pages/desktop.renderer.src.shell.stages.lithology.LithoBoreholesInModel
   ../pages/desktop.renderer.src.shell.stages.lithology.LithoCommittedPill
   ../pages/desktop.renderer.src.shell.stages.lithology.LithoConfidenceFadeToggle
   ../pages/desktop.renderer.src.shell.stages.lithology.LithoExcludedBoreholes
   ../pages/desktop.renderer.src.shell.stages.lithology.LithoFormationRoster
   ../pages/desktop.renderer.src.shell.stages.lithology.LithoResolveAction
   ../pages/desktop.renderer.src.shell.stages.lithology.LithoSolidLegend
   ../pages/desktop.renderer.src.shell.stages.lithology.LithologyCanvas
   ../pages/desktop.renderer.src.shell.stages.lithology.LithologyInspector
   ../pages/desktop.renderer.src.shell.stages.lithology.LithologyStage
   ../pages/desktop.renderer.src.shell.stages.lithology.ModelKindPicker
   ../pages/desktop.renderer.src.shell.stages.parameters.AxisTickRow
   ../pages/desktop.renderer.src.shell.stages.parameters.CptSbtDepthPanels
   ../pages/desktop.renderer.src.shell.stages.parameters.ParametersCanvas
   ../pages/desktop.renderer.src.shell.stages.parameters.ParametersInspector
   ../pages/desktop.renderer.src.shell.stages.parameters.ParametersStage
   ../pages/desktop.renderer.src.shell.stages.parameters.UnitDistributionChannelRow
   ../pages/desktop.renderer.src.shell.stages.parameters.UnitDistributionPanels
   ../pages/desktop.renderer.src.shell.stages.parameters.UnitFenceCutout
   ../pages/desktop.renderer.src.shell.stages.parameters.UnitFenceScene
   ../pages/desktop.renderer.src.shell.stages.parameters.UnitGroupActionBar
   ../pages/desktop.renderer.src.shell.stages.parameters.UnitIdentificationPanels
   ../pages/desktop.renderer.src.shell.stages.parameters.UnitListPane
   ../pages/desktop.renderer.src.shell.stages.parameters.UnitNadParameters
   ../pages/desktop.renderer.src.shell.stages.parameters.UnitPsdPanel
   ../pages/desktop.renderer.src.shell.stages.parameters.UnitStatisticsCanvas
   ../pages/desktop.renderer.src.shell.stages.parameters.depthPanelGeometry
   ../pages/desktop.renderer.src.shell.stages.parameters.fenceCutoutFilter
   ../pages/desktop.renderer.src.shell.stages.parameters.groupScope
   ../pages/desktop.renderer.src.shell.stages.parameters.icBands
   ../pages/desktop.renderer.src.shell.stages.parameters.parameterBodyTree
   ../pages/desktop.renderer.src.shell.stages.parameters.parameterScopeHeader
   ../pages/desktop.renderer.src.shell.stages.parameters.parameterScopeLabels
   ../pages/desktop.renderer.src.shell.stages.parameters.parameterUnitBodies
   ../pages/desktop.renderer.src.shell.stages.parameters.sampleColor
   ../pages/desktop.renderer.src.shell.stages.parameters.sampleSectionReveal
   ../pages/desktop.renderer.src.shell.stages.parameters.scopeNadParameters
   ../pages/desktop.renderer.src.shell.stages.parameters.tabs.MethodConfigTab
   ../pages/desktop.renderer.src.shell.stages.parameters.tabs.PerTestTab
   ../pages/desktop.renderer.src.shell.stages.parameters.tabs.PerUnitTab
   ../pages/desktop.renderer.src.shell.stages.parameters.unitFenceFrame
   ../pages/desktop.renderer.src.shell.stages.parameters.unitFenceSceneConstants
   ../pages/desktop.renderer.src.shell.stages.parameters.unitGrouping
   ../pages/desktop.renderer.src.shell.stages.parameters.unitIdentification
   ../pages/desktop.renderer.src.shell.stages.parameters.unitPsd
   ../pages/desktop.renderer.src.shell.stages.parameters.unitStatistics
   ../pages/desktop.renderer.src.shell.stages.parameters.unitTreeView
   ../pages/desktop.renderer.src.shell.stages.parameters.useBodyUnions
   ../pages/desktop.renderer.src.shell.stages.parameters.useModelBodies
   ../pages/desktop.renderer.src.shell.stages.parameters.useUnitGrouping
   ../pages/desktop.renderer.src.shell.stages.parameters.useUnitStatistics
   ../pages/desktop.renderer.src.shell.stages.shared.BodyViewModePills
   ../pages/desktop.renderer.src.shell.stages.shared.exportFenceDxf
   ../pages/desktop.renderer.src.shell.stages.shared.fetchApprovedEdgesBySection
   ../pages/desktop.renderer.src.shell.stages.shared.makeBodyRecomputeBuilder
   ../pages/desktop.renderer.src.shell.stages.shared.makeDividePartitionBuilder
   ../pages/desktop.renderer.src.shell.stages.shared.makeVoxelRequestBuilder
   ../pages/desktop.renderer.src.shell.stages.shared.splitViewport
   ../pages/desktop.renderer.src.shell.stages.shared.useBody3DViewState

