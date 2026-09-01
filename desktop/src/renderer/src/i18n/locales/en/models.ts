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
    'Select formations to include. Use "→ same as" on a row to lump it into another formation. If your selection leaves out formations already in the model, Apply asks whether to add to the model or replace it.',
  'geology.filterFormationPlaceholder': 'Filter or type a target formation name',
  'geology.rerankPlaceholder': 'Type to re-rank or enter name…',
  'geology.noStratigraphyCandidates': 'No stratigraphy candidates found.',
  // Geology toolbar verbs + dialogs.
  'geology.scanning': 'Scanning…',
  'geology.applying': 'Applying…',
  'geology.building': 'Building…',
  'geology.cleaning': 'Cleaning…',
  'geology.deleting': 'Deleting…',
  'geology.noBoreholesVisible': 'No boreholes visible in this project',
  'geology.scanningStratigraphy': 'Scanning borehole stratigraphy…',
  'geology.applyingSelection': 'Applying selection…',
  'geology.fillTitle':
    'Discover formation names from borehole stratigraphy and select which to keep',
  'geology.buildStale': 'Build 3D model · {n} stale',
  'geology.buildNoModel': 'No active stratigraphy — create formations and contacts first',
  'geology.buildNoContacts':
    'No contacts yet — open a cross-section, then Seed from stratigraphy on the geology axis or pick contacts manually before Build',
  'geology.building3d': 'Building 3D model…',
  'geology.surfacesNeedRebuildOne': '{n} formation surface needs rebuilding — click to compute TINs',
  'geology.surfacesNeedRebuildMany':
    '{n} formation surfaces need rebuilding — click to compute TINs',
  'geology.rebuildTins': 'Rebuild TIN surfaces from current contacts',
  'geology.dedupe': 'Dedupe',
  'geology.noActiveStratigraphy': 'No active stratigraphy',
  'geology.dedupeTitle':
    'Remove duplicate (anchor, formation) contacts — keeps the most-recent pick in each group',
  'geology.resetView': 'Reset view',
  'geology.resetViewTitle': 'Reset to single 3D view and fly camera to model bounding box',
  'geology.deleteStratigraphyShort': 'Delete stratigraphy',
  'geology.deleteStratigraphyTitle':
    'Permanently delete the active geological model and all its formations, contacts, and surfaces',
  'geology.moreActions': 'More geology actions',
  'geology.applyFailed': 'Could not apply formation selection — check the connection.',
  'geology.deleteFailed': 'Could not delete the model.',
  'geology.selectionExcludePrefix': 'Your selection does not include',
  'geology.selectionExcludeSuffix': 'already in this model.',
  'geology.unitWordOne': 'unit',
  'geology.unitWordMany': 'units',
  'geology.unitCount': '{n} {unit}',
  'geology.addToModelExplain': 'keeps them and only adds what you selected.',
  'geology.overwriteExplainPrefix': 'permanently removes {n} {unit} not in your selection:',
  'geology.overwriteExplainSuffix': 'and every contact on them.',
  'geology.deleteModelBody':
    'and all its formations, contacts, and cached surfaces will be permanently deleted. This cannot be undone.',
  'geology.deleteModelButton': 'Delete geological model',
  // GeologyStage spine summary.
  'geology.summaryFormationOne': '{n} formation',
  'geology.summaryFormationMany': '{n} formations',
  'geology.summaryStale': '{n} stale',
  // Geology canvas empty state + inline CTA (geologyEmptyState / GeologyCanvas).
  'geology.emptyBuildPrompt': 'No 3D model yet — build it from the stratigraphy.',
  'geology.adding': 'Adding…',
  // Geology inspector (roster header, crossings banner, delete confirm, rows).
  'geology.stratigraphyLabel': 'Stratigraphy',
  'geology.crossingsNotChecked': 'Surface crossings not checked — Build the 3D model to validate.',
  'geology.crossingsCheckFailed':
    'Surface crossings could NOT be checked — this is not a clean result. Rebuild or reopen the project to check again.',
  'geology.crossingsDetectedOne': '{n} surface crossing detected',
  'geology.crossingsDetectedMany': '{n} surface crossings detected',
  'geology.emptyRosterHint':
    'No formations yet — Fill from boreholes or add one, then build the 3D model.',
  'geology.boreholeInModel': '{name} in model',
  'geology.deleteFormationBody':
    'and every contact + geotech unit pointing at it will be removed from the geological model. This can’t be undone (until File → Save the change isn’t in the .gmproj yet — closing without saving reverts).',
  'geology.dragToReorderNamed': 'Drag to reorder {name}',
  'geology.colorClickToChange': '{color} — click to change colour',
  'geology.changeColorOf': 'Change colour of {name}',
  // Formation selection dialog (Fill from boreholes).
  'geology.formationsFoundOne': '{n} formation found',
  'geology.formationsFoundMany': '{n} formations found',
  'geology.candAll': 'All',
  'geology.candNone': 'None',
  'geology.foundInBoreholesOne': 'found in {n} borehole',
  'geology.foundInBoreholesMany': 'found in {n} boreholes',
  'geology.updating': 'Updating…',
  'geology.boreholeWordOne': 'borehole',
  'geology.boreholeWordMany': 'boreholes',
  'geology.boundaryWordOne': 'boundary',
  'geology.boundaryWordMany': 'boundaries',
  'geology.formationWordOne': 'formation',
  'geology.formationWordMany': 'formations',
  'geology.contactWordOne': 'contact',
  'geology.contactWordMany': 'contacts',
  'geology.collisionSummary':
    '{count} {boreholeWord} had layers lumping to the same formation — kept shallowest, dropped {dropped} {boundaryWord}; review your grouping',
  'geology.collisionInBorehole': 'in borehole',
  'geology.collisionCollidingNames': ': colliding names:',
  'geology.collisionKept': '. Kept top at {top}m, dropped {dropped}.',
  'geology.deletionWarning':
    '{fCount} {formationWord} and {cCount} {contactWord} are not in your selection. Apply will ask whether to keep or remove them.',
  'geology.reassignedToClickChange': 'Reassigned to "{label}" — click to change',
  'geology.reassignToAnother': 'Reassign "{name}" to another formation',
  'geology.sameAs': '→ same as',
  'geology.useCustomName': 'Use "{name}"',

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
  // Confirm / reassign / detach parent dialog.
  'litho.assignParent': 'Assign parent formation',
  'litho.confirmExtrapolatedParent': 'Confirm extrapolated parent',
  'litho.orphanBlurb': 'No geology contact covered this litho unit at the investigation.',
  'litho.extrapolatedBlurb':
    'The parent was inferred from the geology TIN — please confirm or change it.',
  'litho.detach': 'Detach',
  'litho.confirm': 'Confirm',
  'litho.reassign': 'Reassign',
  // Model-kind picker row.
  'litho.newShort': 'New',
  'litho.selectPlaceholder': '— select —',
  'litho.thisModelFallback': 'This model',
  'litho.deleteModelBody':
    'and all its formations, contacts, and cached surfaces will be permanently deleted. The geological parent is not affected. This cannot be undone.',
  // Lithology toolbar (Build model / fence / reset).
  'litho.building': 'Building…',
  'litho.buildModelStale': 'Build model · stale',
  'litho.buildModel': 'Build model',
  'litho.buildNoContacts':
    'No litho contacts yet — open a cross-section on the litho axis, Suggest litho, accept the layers, then return here to Build',
  'litho.buildingSolids': 'Building watertight body solids…',
  'litho.solidsStale': 'One or more body solids are stale — click to rebuild',
  'litho.buildSolidsTitle': 'Build the 3-D body solids from accepted contacts',
  // Lithology inspector (roster + solids legend).
  'litho.createGeoFirst':
    'Create a geological model first (Geology stage) — a lithostratigraphic model refines it.',
  'litho.clearing': 'Clearing…',
  'litho.clearShort': 'Clear',
  'litho.instances': 'Instances',
  'litho.resolving': 'Resolving…',
  'litho.resolveInstances': 'Resolve instances',
  'litho.clearModelBody':
    'All litho units, contacts, correlations and surfaces in this model will be permanently deleted. This cannot be undone.',
  'litho.clearModelButton': 'Clear litho model',
  'litho.parentExtrapolatedReview': 'Parent extrapolated from TIN — click to confirm or reassign',
  'litho.noParentReview': 'No parent assigned — click to assign or detach',
  'litho.pillCounts': '{c} {cw}, {u} {uw}',
  'litho.contactWordOne': 'contact',
  'litho.contactWordMany': 'contacts',
  'litho.unitWordOne': 'unit',
  'litho.unitWordMany': 'units',
  'litho.lensDefinedOne': '{n} lens defined in this formation',
  'litho.lensDefinedMany': '{n} lenses defined in this formation',
  'litho.showMarkersN': 'Show {n} marker {bodies}',
  'litho.hideMarkersN': 'Hide {n} marker {bodies} (under-constrained)',
  'litho.bodyWordOne': 'body',
  'litho.bodyWordMany': 'bodies',
  'litho.showMarkers': 'Show markers',
  'litho.hideMarkers': 'Hide markers',
  'litho.collapseGroup': 'Collapse group',
  'litho.expandGroup': 'Expand group',
  'litho.bodyCount': '{n} {bodies}',
  'litho.markersHidden': '({n} {markers} hidden)',
  'litho.markers': '({n} {markers})',
  'litho.markerWordOne': 'marker',
  'litho.markerWordMany': 'markers',
  'litho.bodiesForName': 'Bodies for {name}',
  'litho.colourForBody': 'Colour for {name} #{ordinal}',

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
  // Re-subdivide confirm dialog body (ReSubdivideConfirmDialog). Split around
  // the bold / em-emphasised fragments so each keeps its emphasis.
  'geotech.thisSectionFallback': 'this section',
  'geotech.reSubdivideModelPre': 'Re-deriving under',
  'geotech.reSubdivideModelMid': 'clears all subdivisions',
  'geotech.reSubdivideModelWide': 'model-wide',
  'geotech.reSubdivideModelPost':
    '— every section’s packing bands and connections are rebuilt from the CPT data, and every borehole goes empty until you divide it again.',
  'geotech.reSubdivideRegenPre':
    'Re-subdividing regenerates the geotech packing connections on',
  'geotech.reSubdivideRegenPost': '— any manual connections you made there will be cleared.',
  'geotech.reSubdivideHandPre': 'It also rebuilds the packing bands on',
  'geotech.reSubdivideHandMid': 'from the CPT data, so its',
  'geotech.reSubdivideHandBandOne': '{n} hand-edited band',
  'geotech.reSubdivideHandBandMany': '{n} hand-edited bands',
  'geotech.reSubdivideHandPost':
    'go back to the segmenter’s boundaries. That cannot be recovered.',
  'geotech.reSubdivideAltPre': 'To get the automatic ties back',
  'geotech.reSubdivideAltEm': 'without',
  'geotech.reSubdivideAltPost':
    'losing your own, cancel and use Correlate packing → Auto-correlate instead.',
  // Geotech units roster (right pane).
  'geotech.unitsWithBands': '{count} with bands',
  'geotech.collapseSoil': 'Collapse this soil',
  'geotech.expandSoil': 'Expand this soil',
  // The class-row expander reveals the unit instances OR the selectable body
  // children (owner dogfeed 2026-09-01) — the tooltip names whichever it opens.
  'geotech.collapseClassChildren': 'Collapse this class',
  'geotech.expandClassUnits': 'Show the {count} units carrying this class',
  'geotech.expandClassBodies': 'Show the bodies in this class',
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
