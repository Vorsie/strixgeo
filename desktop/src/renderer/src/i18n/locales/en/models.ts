// The three model stages — geological, lithostratigraphic, geotechnical.
//
// Part of the English message catalogue — see 'locales/en/index.ts' for the
// key-naming rules and the domain-canon carve-out.

export const MODELS = {
  // -------------------------------------------------------------------------
  // geology stage.
  // -------------------------------------------------------------------------
  'geology.formations': 'Formations',
  'geology.addFormation': 'Add formation',
  'geology.addFormationHint': 'Add a new formation to this project',
  'geology.createFormation': 'Create formation',
  'geology.editFormation': 'Edit formation',
  'geology.deleteFormation': 'Delete formation',
  'geology.deleteFormationConfirm': 'Delete formation?',
  'geology.recolorFormation': 'Recolor formation',
  'geology.newFormation': 'New formation',
  'geology.newFormationHint':
    'Create a placeholder formation — rename and recolour it in the inspector',
  'geology.reorderHint': 'Drag to reorder (lower = older)',
  'geology.dropAtBottom': 'Drop here to place at the bottom (oldest)',
  'geology.fillFromBoreholes': 'Fill from boreholes',
  'geology.build3d': 'Build 3D model',
  'geology.activeStratigraphy': 'Active stratigraphy — every formation pick belongs to this model',
  'geology.boreholesInModel': 'Boreholes in model',
  'geology.showBoreholeScopes': 'Show / hide the per-borehole scope toggles',
  'geology.showConfidenceFade': 'Show confidence fade',
  'geology.confidenceFadeHint':
    'Faded triangles in the 3D view + faded contact polylines on sections mark regions where the TIN extrapolates away from nearby data. Toggle off for a uniform colour.',
  'geology.groundSurface': 'Ground surface',
  'geology.deleteModelConfirm': 'Delete geological model?',
  'geology.deleteStratigraphy': 'Delete stratigraphy…',
  'geology.dedupeContacts': 'Dedupe contacts…',
  'geology.addToModel': 'Add to model',
  'geology.overwriteModel': 'Overwrite model',
  'geology.addOrReplace': 'Add to this model, or replace it?',
  'geology.emptyNoBoreholes':
    'No formations yet. This project has no boreholes to fill from — add a formation manually to start the model.',
  'geology.emptyWithBoreholes':
    'No formations yet. Use "Fill from boreholes" in the toolbar to seed them from borehole stratigraphy, or add one manually.',
  'geology.noStratigraphyOnSection': 'No boreholes on this section carry stratigraphy data.',
  'geology.noInterpretationData':
    'No borehole carries interpretation data — add formations manually in the inspector instead.',
  'geology.surfaceCrossingWarnings': 'Surface crossing warnings',
  'geology.surfaceValidationFailed': 'Surface validation failed',
  'geology.surfaceValidationPending': 'Surface validation pending',
  'geology.openOffendingSection':
    'Open the cross-section containing the offending contacts and pan to them.',
  'geology.noSectionForContact':
    'No cross-section contains the offending contact — draw one through the borehole or CPT to view it.',
  'geology.loadFailed':
    'Could not load the geological model — check the connection and reopen the project.',
  'geology.splitView': 'Split view',
  'geology.singleView': 'Single view',
  'geology.singleViewHint': 'Collapse back to a single view',
  'geology.drawSplitLine': 'Draw a line across the model to split it into two independently-panned views',
  'geology.cancelSplit': 'Cancel split',
  'geology.cancelSplitHint': 'Cancel the split-line draw',
  'geology.reset3dView': 'Reset 3D view',
  'geology.offlineBasemap': 'Offline — basemap unavailable. Formation geometry is unaffected.',
  // 3-D LAYERS legend chrome.
  'geology.layers': 'Layers',
  'geology.basemap': 'Basemap',
  'geology.hideBasemap': 'Hide basemap',
  'geology.showBasemap': 'Show basemap',
  'geology.hideGroundSurface': 'Hide ground surface',
  'geology.showGroundSurface': 'Show ground surface',
  'geology.showIn3d': 'Show in 3D',
  'geology.hideIn3d': 'Hide in 3D',
  'geology.thisModel': 'This model',
  'geology.splitModel': 'Split model',
  'geology.drawSplitFirst': 'Click two points to draw a split line',
  'geology.drawSplitSecond': 'Click the second point to complete the split line',
  'geology.compareWith': 'Compare with {label}',
  'geology.compareWithHint': 'Show {label} beside this model at the same viewpoint',
  // GeotechLayersTree — the nested soil ▸ class ▸ body legend rows.
  'geology.collapseNamed': 'Collapse {label}',
  'geology.expandNamed': 'Expand {label}',
  'geology.showNamedIn3d': 'Show {label} in 3D',
  'geology.hideNamedIn3d': 'Hide {label} in 3D',
  'geology.showBodyIn3d': 'Show body {label} in 3D',
  'geology.hideBodyIn3d': 'Hide body {label} in 3D',
  'geology.underConstrainedBody': 'Under-constrained body',
  'geology.switchBasemap': 'Switch basemap',
  'geology.formationCandidates': 'Formation candidates',
  'geology.targetFormationOptions': 'Target formation options',
  'geology.keepSeparate': 'Keep separate',
  'geology.applySelection': 'Apply selection',
  'geology.lumpingCollisions': 'Lumping collision warnings',
  'geology.selectFormationsBlurb':
    'Select formations to include. Use "→ same as" on a row to lump it into another.',
  'geology.filterFormationPlaceholder': 'Filter or type a target formation name',
  'geology.rerankPlaceholder': 'Type to re-rank or enter name…',
  'geology.noStratigraphyCandidates': 'No stratigraphy candidates found.',

  // -------------------------------------------------------------------------
  // lithology stage.
  // -------------------------------------------------------------------------
  'litho.model': 'Lithology model',
  'litho.modelFull': 'Lithostratigraphic model',
  'litho.units': 'Lithology units',
  'litho.unitsStale': 'Lithology units — 3-D model is stale, rebuild it',
  'litho.formations': 'Litho formations',
  'litho.bodySolids': 'Body solids',
  'litho.noModel': 'No lithology model',
  'litho.noUnits': 'No litho units in this model yet',
  'litho.stale': 'Stale',
  'litho.staleHint': 'Stale — rebuild to update',
  'litho.createModel': 'Create lithostratigraphic model',
  'litho.createModelHint': 'Create the lithostratigraphic model that refines this geological model',
  'litho.newModel': 'New lithostratigraphic model',
  'litho.newModelHint': 'New lithostratigraphic model (refines the active geological model)',
  'litho.newModelNameLabel': 'New lithostratigraphic model name',
  'litho.modelNamePlaceholder': 'Model name…',
  'litho.activeModel': 'Active lithostratigraphic model',
  'litho.deleteModel': 'Delete lithostratigraphic model',
  'litho.deleteModelConfirm': 'Delete lithostratigraphic model?',
  'litho.deleteModelHint': 'Delete the active lithostratigraphic model',
  'litho.cancelNewModel': 'Cancel new model',
  'litho.createOneToPick': 'Create one to pick contacts on sections',
  'litho.clearModel': 'Clear all litho content for this model',
  'litho.clearModelConfirm': 'Clear litho model?',
  'litho.emptyInspector':
    'Accept CPT suggestions or draw contacts on a section — each accepted layer adds a unit here.',
  'litho.emptyCanvas':
    'Select or create a lithology model in the right panel. Draw contacts in the Sections stage, then click Build model on the Lithology toolbar to generate the 3D solid bodies.',
  'litho.createThenSections':
    'Create a lithology model above, then open the Sections stage to draw contacts.',
  'litho.drawThenBuild': 'Draw contacts on Sections, then Build to update surfaces.',
  'litho.buildToSeeBodies': 'Build the 3D model to see bodies.',
  'litho.allContentBlurb': 'All litho units, contacts, correlations and surfaces in this model',
  'litho.renumberBodies': 'Re-number litho bodies from their correlation graph',
  'litho.pickBodyColour': 'Pick a custom colour for this body solid',
  'litho.resetBodyColour': 'Reset to formation lithology colour',
  'litho.underConstrained':
    'Under-constrained: fewer than 3 CPT/borehole traces — best-effort slab',
  'litho.confidenceFadeHint':
    'Faded triangles in the 3D view mark regions where the model extrapolates away from nearby data. Toggle off for a uniform colour.',
  'litho.parentFormation': 'Parent geological formation',
  'litho.noParent': '— No parent (detach) —',
  'litho.switchSolidFence': 'Switch between solid TIN surfaces and fence-diagram walls',
  'litho.exportFence': 'Export fence',
  'litho.exportFenceHint': 'Save the 3-D fence diagram as a DXF (switch the view to Fence first)',
  'litho.resetCamera': 'Reset camera',
  'litho.resetCameraHint': 'Collapse any split view and fly the camera back to the model extent',
  'litho.nothingToBuild': 'Nothing to build — accept litho layers on a cross-section, then Build.',
  'litho.nothingToExportFence':
    'Nothing to export — switch the 3-D view to Fence and make sure the fence has walls.',
  'litho.autoCorrelateNothing':
    'Auto-correlate: no correlatable units found — accept litho suggestions first.',

  // -------------------------------------------------------------------------
  // geotechnical stage.
  // -------------------------------------------------------------------------
  'geotech.units': 'Geotech units',
  'geotech.unitsFull': 'Geotechnical units',
  'geotech.nadUnits': 'Geotechnical NAD units',
  'geotech.noUnits': 'No geotech units yet',
  'geotech.noBodyModel': 'No geotech body model yet',
  'geotech.noLithoModel': 'No lithostratigraphic model yet',
  'geotech.selectedBody': 'Selected body',
  'geotech.estimateDisclaimer':
    'NAD packing classes are CPT-derived estimates — verify against the borehole descriptions before use.',
  'geotech.rosterBlurb':
    'Geotech units that describe ground in this model. A unit that describes nothing is not listed — there is nothing in it.',
  'geotech.runSubdivideHint':
    "Run 'Subdivide all bodies' to classify the lithostratigraphic units into NAD packing classes.",
  'geotech.buildHint':
    "Run 'Subdivide all bodies' on the Sections stage (geotech axis), then click 'Build model' on the Geotechnical toolbar to generate the 3D NAD body solids.",
  'geotech.switchSolidFence': 'Switch between solid body model and fence-diagram walls',
  'geotech.resetAutoColour': 'Back to the automatic packing colour',
  // Cone-derived is the NORM and carries no badge (owner 2026-08-27); only
  // the exceptions are marked, so there is no key for a "CPT est." badge.
  'geotech.badgeCptEstPartial': 'No CPT (partial)',
  'geotech.badgeNoCpt': 'No CPT',
  'geotech.badgeConfidence':
    'Aggregated confidence of the packing-class assignment across all CPT layers',
  'geotech.badgePartialHint':
    'Most bands derived from CPT qc series. At least one had no cone in its body, so it took the weakest class seen there instead. Check the low-confidence bands before use.',
  'geotech.badgeNoCptHint':
    'No CPT data behind this class. It took the weakest class seen in the body, or the lithology floor. Verify before use.',
  'geotech.reSubdivideConfirm': 'Re-subdivide geotech model?',
  'geotech.reSubdivide': 'Re-subdivide',
  'geotech.preflightKeep':
    'Run the standard subdivide / divide steps on them, then build',
  'geotech.preflightIgnore':
    'Ignore them completely — the result is the model you had before they were imported',
  'geotech.subdivideFirst': 'Subdivide the bodies first.',
  // Geotech units roster (right pane).
  'geotech.unitsWithBands': '{count} with bands',
  'geotech.collapseSoil': 'Collapse this soil',
  'geotech.expandSoil': 'Expand this soil',
  'geotech.bandLabel': '{count} band',
  'geotech.bandsLabel': '{count} bands',
  'geotech.soilClasses': '{soil} classes',
  'geotech.contactLabel': '{count} contact in this model',
  'geotech.contactsLabel': '{count} contacts in this model',
  'geotech.chooseColor': '{color} — click to choose a colour for this unit',
  'geotech.colorForUnit': 'Colour for {label}',
  'geotech.unitsCarryClass': '{count} separate units carry this class',
  'geotech.unitsClassed': 'Units classed {label}',
  'geotech.sampleSource': 'Sample source:',
} as const
