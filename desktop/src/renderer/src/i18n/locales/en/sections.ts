// Sections stage — the cross-section canvas, toolbar, inspector, header,
// context menus and overlay hints. The largest single surface in the app.
//
// Part of the English message catalogue — see 'locales/en/index.ts' for the
// key-naming rules and the domain-canon carve-out.

export const SECTIONS = {
  // -------------------------------------------------------------------------
  // sections stage — canvas, toolbar, inspector, header.
  // -------------------------------------------------------------------------
  'sections.title': 'Cross-sections',
  'sections.new': 'New cross-section',
  'sections.newPlus': '+ New cross-section',
  'sections.none': 'No cross-sections yet',
  'sections.emptyBlurb':
    'Draw a line on the map to define a section, or create one with placeholder endpoints to start.',
  'sections.delete': 'Delete cross-section…',
  'sections.deleteConfirm': 'Delete cross-section?',
  'sections.rename': 'Click to rename this cross-section',
  'sections.name': 'Section name',
  'sections.properties': 'Section properties',
  'sections.modelActions': 'Model actions',
  'sections.moreActions': 'More section actions',
  'sections.geoVerbHint':
    'Switch to the Geology axis — Build / Seed / Dedupe / Plaxis-3D act on the geological model',
  'sections.undoTitle': 'Undo the last model edit (Ctrl+Z)',
  'sections.undoNothing': 'Nothing to undo',
  'sections.recomputeUnavailable': 'Recompute bodies is unavailable — reopen the project.',
  'sections.reset.done':
    'Reset {count} hand-drawn {noun} — bodies returned to their computed shape.',
  'sections.reset.boundaryOne': 'boundary',
  'sections.reset.boundaryMany': 'boundaries',
  'sections.reset.none': 'No hand-drawn boundaries to reset.',
  'sections.reset.failed': 'Reset manual points failed — see console.',

  // Toolbar-owned modal + confirmation dialogs.
  'sections.dialog.thisSection': 'This section',
  'sections.dialog.deleteBody':
    'will be permanently deleted. Formation contacts placed on it are also removed. This cannot be undone.',
  'sections.dialog.deleteConfirmButton': 'Delete cross-section',
  'sections.dialog.bulkPrefix': 'The lithology segmenter will run for',
  'sections.dialog.bulkSuffix':
    'in this section. Any existing bulk-suggest ghosts will be replaced. Already-committed contacts on the section stay untouched.',
  'sections.dialog.noInvestigations': 'No investigations',
  'sections.dialog.resetBody':
    'Every hand-drawn boundary point on this model will be cleared and the bodies will return to their computed shape. This cannot be undone.',

  // Sections inspector (right panel) — list, properties, model actions,
  // borehole-preview legend, formation list, crossings banner.
  'sections.inspector.noCrossSectionForContact':
    'No cross-section contains the offending contact — draw one through the borehole or CPT to view it.',
  'sections.inspector.staleBadge': '{n} stale',
  'sections.inspector.geologicalModel': 'Geological model',
  'sections.inspector.previewLegend':
    'Hatched bands = preview. Right-click a ghost column to divide just that borehole, or press “4 · Divide boreholes” to commit them all.',
  'sections.inspector.previewClampedOne':
    '{n} planned band outside the depth window — zoom out to see it.',
  'sections.inspector.previewClampedMany':
    '{n} planned bands outside the depth window — zoom out to see them.',
  'sections.inspector.backdropClickPrefix': 'Click',
  'sections.inspector.backdropClickSuffix': 'in Model actions to load.',
  // Section list.
  'sections.inspector.setCrsFirst': 'Set a Default horizontal CRS in Project metadata first',
  'sections.inspector.createSection': 'Create a new cross-section',
  'sections.inspector.setCrsToCreate': 'Set a CRS to create sections',
  'sections.inspector.dirtyCreated': 'Created since last save — File → Save to commit',
  // Crossings banner.
  'sections.inspector.validationFailedLabel': 'Surface validation failed',
  'sections.inspector.validationFailedBody':
    'Surface crossings could NOT be checked — this is not a clean result. Rebuild or reopen the project to check again.',
  'sections.inspector.validationPendingLabel': 'Surface validation pending',
  'sections.inspector.validationPendingBody':
    'Surface crossings not checked — Build the 3D model to validate.',
  'sections.inspector.crossingWarningsLabel': 'Surface crossing warnings',
  'sections.inspector.crossingsDetectedOne': '{n} surface crossing detected',
  'sections.inspector.crossingsDetectedMany': '{n} surface crossings detected',
  'sections.inspector.openOffendingSection':
    'Open the cross-section containing the offending contacts and pan to them.',
  // Model actions.
  'sections.inspector.geoAxisHintBuildDedupe':
    'Switch to the Geology axis — Build / Dedupe act on the geological model',
  'sections.inspector.buildNoModel':
    'No active geological model — create formations and contacts first',
  'sections.inspector.buildingSurfaces': 'Building surfaces…',
  'sections.inspector.surfacesNeedRebuildOne':
    '{n} formation surface needs rebuilding — click to compute TINs',
  'sections.inspector.surfacesNeedRebuildMany':
    '{n} formation surfaces need rebuilding — click to compute TINs',
  'sections.inspector.rebuildTins': 'Rebuild TIN surfaces from current contacts',
  'sections.inspector.building': 'Building…',
  'sections.inspector.buildStale': 'Build · {n} stale',
  'sections.inspector.buildModel': 'Build model',
  'sections.inspector.noParentGeoModel': 'No parent geological model linked',
  'sections.inspector.loadingGeoSurfaces': 'Loading geological surfaces…',
  'sections.inspector.syncGeologyTitle':
    'Load the parent geological model’s surfaces as a read-only backdrop reference on this section',
  'sections.inspector.syncing': 'Syncing…',
  'sections.inspector.syncGeology': 'Sync geology',
  'sections.inspector.seedDefineFirst':
    'Define formations in the Geology stage first — Seed places contacts for already-defined layers',
  'sections.inspector.seedingContacts': 'Seeding contacts from borehole stratigraphy…',
  'sections.inspector.seedTitle':
    'Place contacts from borehole observations for formations already defined in the model — run Dedupe if duplicates appear',
  'sections.inspector.seeding': 'Seeding…',
  'sections.inspector.seed': 'Seed',
  'sections.inspector.seedDefineFirstShort': 'Define formations in the Geology stage first',
  'sections.inspector.allHaveGeologyContacts':
    'All boreholes in scope already have geology contacts — import new tests to use this',
  'sections.inspector.seedNewTestsTitleOne':
    'Place contacts from stratigraphy for the {n} borehole with no geology contacts yet',
  'sections.inspector.seedNewTestsTitleMany':
    'Place contacts from stratigraphy for the {n} boreholes with no geology contacts yet',
  'sections.inspector.seedForNewTests': 'Seed for new tests',
  'sections.inspector.cleaning': 'Cleaning…',
  'sections.inspector.dedupeTitle':
    'Remove duplicate (anchor, formation) contacts — keeps the most-recent pick in each group',
  'sections.inspector.dedupe': 'Dedupe',
  'sections.modelAxis': 'Section model axis',
  'sections.buffer': 'Projection buffer',
  'sections.bufferLabel': 'Projection buffer (m)',
  'sections.bufferLateral': 'Lateral projection buffer',
  'sections.bufferHint':
    'Lateral distance from the section line within which investigations are projected',
  'sections.vex': 'Vertical exaggeration',
  'sections.vexShort': 'V exag',
  'sections.vexHint':
    'Vertical exaggeration applied to the section view (1 = no exaggeration, 10 = 10× stretched)',
  'sections.columnSpacing': 'Column spacing',
  'sections.columnSpacingHint':
    'Spacing between investigations — at 0% tests render at their true projected X (bands may overlap)',
  'sections.referenceGeologicalModel': 'Reference geological model',
  'sections.geologyBackdrop': 'Geology backdrop (litho axis)',
  'sections.geologyBackdropHint': 'Shown as a faint reference layer when the litho axis is active.',
  'sections.syncGeology': 'Sync geology',
  'sections.boreholePreview': 'Borehole preview',
  'sections.virtueleBoringOverlay': 'Virtuele Boring overlay',
  'sections.closeView': 'Close section view',
  'sections.closeViewHint': 'Close section view (back to map)',
  'sections.resetFraming': 'Reset view to default framing',
  'sections.exitFocus': 'Exit focus mode',
  'sections.exitFocusHint': 'Exit focus mode (Esc)',
  'sections.noFormationContacts': 'No formation contacts on this section',
  'sections.restoreHidden':
    'Restore every test hidden from this section. Their columns reappear on the next render.',
  'sections.sizingCanvas': 'Sizing canvas…',
  'sections.findColumn': 'Find column',
  'sections.findColumnPlaceholder': 'Find column… (e.g. S8)',
  'sections.closeFind': 'Close find',
  'sections.columnName': 'Column name',
  'sections.zoomInHint': 'Zoom in (or scroll the canvas)',
  'sections.zoomOutHint': 'Zoom out (or scroll the canvas)',

  // Axis pill — the Geology / Litho / Geotech segmented control.
  'sections.axis.geoShort': 'Geo',
  'sections.axis.litho': 'Litho',
  'sections.axis.geotech': 'Geotech',
  'sections.axis.createLithoFirst': 'Create a lithostratigraphic model in the Lithology stage first',
  'sections.axis.editLithoContacts':
    'Edit the lithostratigraphic model contacts on this section',
  'sections.axis.createLithoForPacking':
    'Create a lithostratigraphic model first — packing subdivides litho bodies',
  'sections.axis.viewGeotech':
    'View geotechnical subdivision (NAD packing classes) on this section',
  'sections.axis.noGeotechYet':
    'No geotech model yet — “Packing pipeline → 1 · Subdivide CPTs” creates it',

  // Model-level words, interpolated into the export + recompute tooltips. Kept
  // as their own keys so "No active {level} model" reads grammatically in each
  // locale (Dutch keeps the adjective before the noun, same as English).
  'sections.level.litho': 'lithostratigraphic',
  'sections.level.geotech': 'geotechnical',
  'sections.level.geological': 'geological',
  'sections.level.geotechShort': 'geotech',

  // Transient busy labels shared by several verbs.
  'sections.busy.accepting': 'Accepting…',
  'sections.busy.creating': 'Creating…',
  'sections.busy.deleting': 'Deleting…',
  'sections.busy.recomputing': 'Recomputing…',
  'sections.busy.exporting': 'Exporting…',
  'sections.busy.suggesting': 'Suggesting…',
  'sections.busy.subdividing': 'Subdividing…',
  'sections.busy.correlating': 'Correlating…',
  'sections.busy.dividing': 'Dividing…',

  // Tail verbs — New / Delete / Tie-sections / Recompute.
  'sections.tail.newSection': 'New cross-section',
  'sections.tail.newSectionTitle': 'Create a new cross-section (placeholder endpoints)',
  'sections.tail.delete': 'Delete',
  'sections.tail.deleteSectionMenu': 'Delete cross-section…',
  'sections.tail.deleteSelectFirst': 'Select a cross-section to delete it',
  'sections.tail.deleteConfirmMenuTitle': 'Delete "{name}" — asks for confirmation first',
  'sections.tail.deleteTitle': 'Delete "{name}"',
  'sections.tail.recompute': 'Recompute bodies',
  'sections.tail.recomputeNone': 'No active {level} model to recompute',
  'sections.tail.recomputeTitle':
    'Re-derive the persisted geometric body identity from the current sections now',

  // Tie-sections split verb (tail).
  'sections.tie.suggestSections': 'Suggest tie-sections',
  'sections.tie.clearSuggestions': 'Clear tie suggestions',
  'sections.tie.acceptAll': 'Accept all ties',
  'sections.tie.acceptAllRunFirst': 'Run "Suggest tie-sections" first',
  'sections.tie.acceptAllBusy': 'Creating cross-sections for all proposed ties…',
  'sections.tie.acceptAllTitle': 'Create a cross-section for every proposed tie',
  'sections.tie.needTwo': 'Need at least 2 sections to tie together',
  'sections.tie.clearTitle': 'Clear the current tie-section suggestions',
  'sections.tie.suggestTitle':
    'Suggest perpendicular connector sections between existing sections (no crossings, no shared tests)',

  // Export dropdown.
  'sections.export.selectSection': 'Select a section to export',
  'sections.export.dropdownTitle': 'Export the model or this section',
  'sections.export.sectionDxf': 'Section DXF',
  'sections.export.exportingDxf': 'Exporting DXF…',
  'sections.export.noModelContacts': 'No active {level} model — contacts must exist first',
  'sections.export.dxfTitle': 'Export this section’s {level} model as DXF',
  'sections.export.plaxisScript': 'Plaxis 3D script',
  'sections.export.exportingPlaxis': 'Exporting Plaxis…',
  'sections.export.noGeologicalModel': 'No active geological model',
  'sections.export.plaxisTitle':
    'Export the geological model as a Plaxis 3D plxscripting Python script',
  'sections.export.sectionPdf': 'Section PDF report',
  'sections.export.generatingPdf': 'Generating PDF…',
  'sections.export.noModelDefine': 'No active {level} model — define one first',
  'sections.export.pdfTitle': 'Generate a PDF report of this section’s {level} model',
  // D-Series (closed-geometry) rows. The label + format names stay identical in
  // NL (product + file-extension names).
  'sections.export.dstability': 'D-Stability (.stix)',
  'sections.export.exportingDstability': 'Exporting D-Stability…',
  'sections.export.dsheetpiling': 'D-Sheet Piling (.shi)',
  'sections.export.exportingDsheetpiling': 'Exporting D-Sheet Piling…',
  'sections.export.dstabilityFilter': 'D-Stability model',
  'sections.export.dsheetpilingFilter': 'D-Sheet Piling profile',
  'sections.export.dstabilitySuccess': 'D-Stability model exported.',
  'sections.export.dsheetpilingSuccess': 'D-Sheet Piling profile exported.',
  'sections.export.dstabilityFailure': 'Could not export the D-Stability model.',
  'sections.export.dsheetpilingFailure': 'Could not export the D-Sheet Piling profile.',
  'sections.export.dstabilityDescribes':
    'model as a D-Stability .stix (geometry only — no design parameters)',
  'sections.export.dsheetpilingDescribes':
    'model as a D-Sheet Piling .shi soil profile through the section (geometry only)',
  'sections.export.dseriesRowTitle': 'Export this section’s {level} {describes}',
  'sections.export.nothingDrawn':
    'Nothing to export — this section has no drawn {level} geometry between two columns.',
  'sections.export.readFailed': 'Could not read this section — nothing was exported.',

  'sections.toolbar.display': 'Display',
  'sections.toolbar.bodies': 'Bodies',
  'sections.toolbar.geology': 'Geology',
  'sections.toolbar.export': 'Export',
  'sections.toolbar.undo': 'Undo',
  'sections.toolbar.undoHint': 'Undo last model edit',
  'sections.toolbar.clear': 'Clear',
  'sections.toolbar.clearBulk': 'Clear bulk',
  'sections.toolbar.correlateContacts': 'Correlate contacts',
  'sections.toolbar.uncorrelateContacts': 'Uncorrelate contacts',
  'sections.toolbar.acceptAllSuggestions': 'Accept all suggestions',
  'sections.toolbar.acceptAllBulkSuggestions': 'Accept all bulk suggestions',
  'sections.toolbar.clearLithoSuggestions': 'Clear litho suggestions',
  'sections.toolbar.clearCorrelationSuggestions': 'Clear correlation suggestions',
  'sections.toolbar.clearBulkGhosts': 'Clear bulk ghost overlays',
  'sections.toolbar.dismissLithoGhost': 'Dismiss the current litho suggestion overlay',
  'sections.toolbar.dismissBulkGhosts': 'Dismiss the bulk-suggest ghost overlays for every investigation',
  'sections.toolbar.suggestAllTests': 'Suggest lithos for all tests?',
  'sections.toolbar.recomputeBodies': 'Recompute bodies',
  'sections.toolbar.resetPoints': 'Reset points',
  'sections.toolbar.resetPointsConfirm': 'Reset all manual points?',
  'sections.toolbar.resetPointsBody':
    'Every hand-drawn boundary point on this model will be cleared and the bodies will be rebuilt from the correlations alone.',
  'sections.toolbar.admixtures': 'Admixtures',
  'sections.toolbar.reseedAdmixtures': 'Reseed borehole admixtures',
  'sections.toolbar.stripAdmixtures': 'Strip all admixtures',
  'sections.toolbar.clearGhostAdmixtures': 'Clear admixtures from every ghost suggestion',
  'sections.toolbar.editGeologyContacts': 'Edit the geological model contacts on this section',
  'sections.toolbar.noLithoModel': 'No lithostratigraphic model — create one in the Lithology stage.',
  'sections.toolbar.showLayers': 'Show or hide layers of the section view',
  'sections.toolbar.applyNextSubdivide': 'Applies to the next Subdivide — nothing re-runs now',
  'sections.toolbar.statisticFailed': 'Could not set the statistic.',
  'sections.toolbar.noPackingBands':
    'No packing bands on this section yet — run "1 · Subdivide CPTs" on this section first',
  'sections.toolbar.packingFlowHint':
    'The four-step packing flow: 1 subdivide the CPTs, 2 propose ties, 3 review and accept them, 4 divide the boreholes. All four act on the section you have open and leave every other section as it is, so you can finish one cross-section while the next still has proposals waiting. Step 4 stays locked until this section’s ties are all accepted or deleted.',
  'sections.toolbar.previewDivideHint':
    'Preview the packing bands "4 · Divide boreholes" would commit, hatched over the borehole columns. Nothing is written.',
  'sections.toolbar.lithoFillHint':
    'Colour every body’s closed loop with its lithology, across the section. Do this once correlations + pinch-outs are done. Toggles on / off.',
  'sections.toolbar.correlationRibbonsHint':
    'Show or hide the correlation ribbons + lines drawn across the section. A 2-D visualisation of your correlations only — it has no link to the 3-D model. Toggles on / off.',
  'sections.toolbar.solidFillHint':
    'Show or hide the cross-section fill sampled from the built 3-D solids. Toggles on / off.',
  'sections.toolbar.geotechSolidFillHint':
    'Show or hide the fill cut out of the BUILT 3-D geotechnical solids — the model as of the last Build, not the live bands. One fill renders at a time.',
  'sections.toolbar.packingFillHint':
    'Show or hide the NAD packing-band fill — the LIVE packing classes, as the pipeline last wrote them. One fill renders at a time.',
  'sections.toolbar.swapFillHint':
    'Swap the lithostratigraphic fill in for the NAD packing fill — one fill renders at a time, never both.',
  'sections.toolbar.qcStatisticHint':
    'Which representative qc the NAD classifier reads, chosen BEFORE you build the packing bands under it. The choice applies to the NEXT "1 · Subdivide CPTs", and bands already on screen keep the statistic they were built with until you re-run it.',
  'sections.toolbar.sampleMarkersHint':
    'Show or hide the lab-sample markers on the borehole columns. Each marker spans the depth interval its sample was taken over.',
  'sections.toolbar.psdCardHint':
    'Show a grain-size distribution card while hovering a sample marker. Press P to toggle without opening this menu.',

  // Litho-axis toolbar verbs + their caret / dropdown menus.
  'sections.litho.suggest': 'Suggest',
  'sections.litho.suggestAll': 'Suggest all',
  'sections.litho.createModelFirst': 'Create a lithostratigraphic model first',
  'sections.litho.openSectionSuggest': 'Open a cross-section to use Suggest',
  'sections.litho.fetchingSuggestions': 'Fetching suggestions…',
  'sections.litho.suggestAllTitle':
    'Right-click a column to focus one, or click to suggest layers for every investigation in this section ({n})',
  'sections.litho.suggestFocusHint':
    'Right-click a column in the section to focus a CPT or borehole, then Suggest',
  'sections.litho.suggestForColumn': 'Suggest lithostratigraphic layers for {column}',
  'sections.litho.theFocusedInvestigation': 'the focused investigation',
  'sections.litho.acceptAll': 'Accept all',
  'sections.litho.committingSuggestions': 'Committing all suggestion layers…',
  'sections.litho.acceptAllTitle':
    'Accept all non-rejected suggestion layers as lithostratigraphic contacts',
  'sections.litho.clear': 'Clear',
  'sections.litho.acceptAllBulk': 'Accept all (bulk)',
  'sections.litho.committingBulk': 'Committing all bulk suggestion layers…',
  'sections.litho.acceptAllBulkTitle':
    'Accept every non-rejected suggestion across all {n} bulk-ghost {investigation}',
  'sections.litho.investigationOne': 'investigation',
  'sections.litho.investigationMany': 'investigations',
  'sections.litho.clearBulk': 'Clear bulk',
  'sections.litho.correlateActive': 'Correlate · click 2 bands',
  'sections.litho.correlate': 'Correlate',
  'sections.litho.enterCorrelate': 'Enter correlate mode',
  'sections.litho.exitCorrelate': 'Exit correlate mode',
  'sections.litho.openSectionCorrelate': 'Open a cross-section to correlate units',
  'sections.litho.acceptFirstToCorrelate':
    'Accept litho suggestions to enable correlation — 0 accepted contacts on this section',
  'sections.litho.exitCorrelateEsc': 'Exit correlate mode (Esc)',
  'sections.litho.enterCorrelateTitle':
    'Enter correlate mode — click a unit band on one investigation, then a matching unit on another to link them',
  'sections.litho.bodiesTitle': 'Detect, suggest, materialise, or clear body (lens) wedges',
  'sections.litho.admixturesDisabled':
    'Suggest litho layers first — admixture edits act on ghost suggestions',
  'sections.litho.admixturesTitle': 'Strip or reseed admixtures on the current ghost suggestions',
  // Suggest caret menu.
  'sections.litho.suggestAllInSection': 'Suggest all in this section',
  'sections.litho.openSectionFirst': 'Open a cross-section first',
  'sections.litho.runningSegmenterAll': 'Running segmenter on every investigation in this section…',
  'sections.litho.suggestAllInSectionTitle':
    'Suggest lithostratigraphic layers for every investigation in this section at once',
  'sections.litho.suggestNewTests': 'Suggest for new tests',
  'sections.litho.runningSegmenter': 'Running segmenter…',
  'sections.litho.allHaveContacts':
    'All visible investigations already have litho contacts — import new tests to use this',
  'sections.litho.suggestNewTestsTitle':
    'Suggest layers for the {n} {investigation} with no litho contacts yet',
  // Correlate caret menu.
  'sections.litho.autoCorrelate': 'Auto-correlate',
  'sections.litho.runningAutoCorrelate': 'Running auto-correlate…',
  'sections.litho.autoCorrelateTitle':
    'Auto-correlate: match contacts at neighbouring investigations within a depth + distance tolerance — inserts unapproved edges across the whole model. Use "Accept correlations" to approve.',
  'sections.litho.acceptCorrelations': 'Accept correlations',
  'sections.litho.openSectionAcceptCorr': 'Open a cross-section to accept correlations',
  'sections.litho.acceptingCorrelations': 'Accepting correlations…',
  'sections.litho.acceptCorrelationsTitle':
    'Accept all unapproved contact-level correlation edges in this section — commits lens bodies and recomputes ordinals',
  'sections.litho.clearCorrelationsTitle':
    'Remove all unapproved correlation suggestions across the model (keeps approved correlations). Reversible — re-run Auto-correlate to regenerate.',
  // Bodies dropdown menu.
  'sections.litho.fillBands': 'Fill bands',
  'sections.litho.hideBands': 'Hide bands',
  'sections.litho.showCorrelations': 'Show correlations',
  'sections.litho.hideCorrelations': 'Hide correlations',
  'sections.litho.showModelFill': 'Show model fill',
  'sections.litho.hideModelFill': 'Hide model fill',
  'sections.litho.resetManualPoints': 'Reset manual points',
  'sections.litho.resetting': 'Resetting…',
  'sections.litho.resetManualPointsTitle':
    'Clear every hand-drawn body boundary point on this model. Bodies return to their computed shape. Cannot be undone.',
  // Admixtures dropdown menu.
  'sections.litho.stripCptAdmixtures': 'Strip CPT admixtures',
  'sections.litho.noCptGhosts': 'No CPT ghost suggestions',
  'sections.litho.stripCptTitle': 'Clear admixtures from every CPT ghost suggestion',
  'sections.litho.stripBoreholeAdmixtures': 'Strip borehole admixtures',
  'sections.litho.noBoreholeGhosts': 'No borehole ghost suggestions',
  'sections.litho.stripBoreholeTitle': 'Clear admixtures from every borehole ghost suggestion',
  'sections.litho.reseedBoreholeTitle':
    'Restore the segmenter’s admixtures on borehole ghosts (undo a strip)',

  // Lab-sample view toggles (shared by the litho Bodies + geotech Display menus).
  'sections.samples.show': 'Show samples',
  'sections.samples.hide': 'Hide samples',
  'sections.samples.showPsd': 'Show PSD preview on hover',
  'sections.samples.hidePsd': 'Hide PSD preview on hover',

  // Geotech-axis toolbar verbs + their dropdown menus (statistic / pipeline /
  // correlate-packing / display).
  'sections.geotech.statisticMenuTitle':
    'Which representative qc the NAD classifier reads, chosen BEFORE you subdivide: median (spike-robust default), arithmetic, harmonic (conservative — weighted toward the low values that govern bearing and settlement) or geometric. Nothing re-classifies when you change it: the choice applies to the NEXT "1 · Subdivide CPTs", and bands already on screen keep the statistic they were built with until you re-run it.',
  'sections.geotech.pipeline': 'Packing pipeline',
  'sections.geotech.correlatePacking': 'Correlate packing',
  'sections.geotech.exitPackingCorrelate': 'Exit packing-correlate mode',
  'sections.geotech.correlatePackingByHand': 'Correlate packing by hand',
  'sections.geotech.correlatePackingNoModel':
    'Run “1 · Subdivide CPTs” first to create packing bands',
  'sections.geotech.exitPackingCorrelateEsc': 'Exit packing-correlate mode (Esc)',
  'sections.geotech.correlatePackingTitle':
    'Connect same-class packing bands across investigations within the same litho body — the hand correlation the pipeline’s step 2 automates',
  'sections.geotech.currentTag': 'current',
  'sections.geotech.harmonicHint':
    'Conservative: weighted toward the low qc values that govern bearing and settlement.',
  'sections.geotech.medianHint': 'The spike-robust default.',
  'sections.geotech.step1': '1 · Subdivide CPTs',
  'sections.geotech.reRunUnder': 're-run under {stat}',
  'sections.geotech.columnsNeedRederive': '{n} {phrase} re-deriving',
  'sections.geotech.columnNeeds': 'column needs',
  'sections.geotech.columnsNeed': 'columns need',
  'sections.geotech.step1OpenSection':
    'Open a cross-section first — this step subdivides the CPTs on the section you have open',
  'sections.geotech.step1Title':
    'Step 1 of 4 — derive NAD packing classes (1–31) on THIS section’s CPTs, leaving every other section’s bands, ties and bodies untouched. Correlates nothing: “2 · Auto-correlate” proposes the packing ties next. Creates the geotechnical model on first run. A CPT that is on no cross-section is never subdivided.',
  'sections.geotech.step2': '2 · Auto-correlate',
  'sections.geotech.step2OpenSection':
    'Open a cross-section first — this step proposes ties on the section you have open',
  'sections.geotech.noBandsHere':
    'No packing bands on this section yet — run “1 · Subdivide CPTs” on this section first',
  'sections.geotech.step2Title':
    'Step 2 of 4 — derive the same-class packing ties inside each correlated litho unit ON THIS SECTION, jumping across borehole columns that carry no packing yet. Ties that restate a litho correlation you already approved arrive ACCEPTED; the rest arrive as proposals. Hand-drawn correlations are never touched.',
  'sections.geotech.step3': '3 · Accept ties',
  'sections.geotech.pendingHere': '{n} pending here',
  'sections.geotech.step3OpenSection':
    'Open a cross-section first — this step accepts the ties on the section you have open',
  'sections.geotech.step3Title':
    'Step 3 of 4 — review, then approve, on the section in front of you. First DELETE the faulty proposals (right-click a tie → Delete) and accept the ones you want to check off singly (right-click → Accept tie). Then press this to accept every remaining proposal ON THIS SECTION. Afterwards, hand-connect anything auto-correlate missed with “Correlate packing”.',
  'sections.geotech.step4': '4 · Divide boreholes',
  'sections.geotech.staleReDivide': 'stale — re-divide',
  'sections.geotech.step4OpenSection':
    'Open a cross-section first — this step divides the boreholes on the section you have open',
  'sections.geotech.staleReDivideTitle':
    'Bodies or correlations changed — re-divide the boreholes to match',
  'sections.geotech.step4Title':
    'Step 4 of 4 — TIN-divide THIS section’s borehole columns into packing bands, using the CPT transition surfaces and the ties you accepted, and leave every other section as it is. Right-click one borehole’s ghost bands to divide just that column.',
  'sections.geotech.showFill': 'Show fill',
  'sections.geotech.hideFill': 'Hide fill',
  'sections.geotech.showLithoFill': 'Show litho fill',
  'sections.geotech.hideLithoFill': 'Hide litho fill',
  'sections.geotech.showBoreholePreview': 'Show borehole preview',
  'sections.geotech.hideBoreholePreview': 'Hide borehole preview',
  'sections.geotech.correlationsHint':
    'Show or hide the correlation ribbons drawn across the section (2-D visualisation only).',

  'sections.header.cptChannels': 'CPT data channel toggles',
  'sections.header.qc': 'Cone resistance (qc)',
  'sections.header.fs': 'Sleeve friction (fs) — CPTU/CPTE only',
  'sections.header.rf': 'Friction ratio (Rf)',
  'sections.header.u2': 'Pore-water pressure (u2) — CPTU only',
  'sections.header.qTotal': 'Total resistance (qTotal) — CPTM only',
  'sections.header.streamToggles':
    'Borehole interpretation stream toggles — each enabled stream renders as its own strip side by side',
  'sections.header.formalStratigraphy': 'Formal stratigraphy',
  'sections.header.formalStratigraphyShort': 'F-Strat',
  'sections.header.informalStratigraphy': 'Informal stratigraphy',
  'sections.header.informalStratigraphyShort': 'I-Strat',
  'sections.header.geotechnicalCoding': 'Geotechnical coding',
  'sections.header.geotechnicalCodingShort': 'Geo',

  'sections.hints.f1': 'Press F1 for the full gesture reference',
  'sections.hints.lithoLayer':
    'Litho layer: double-click to accept · Alt+drag to copy composition · Shift+drag past neighbour midpoint to absorb · right-click for more',
  'sections.hints.acceptFirst':
    'Accept litho suggestions to enable correlation — 0 accepted contacts on this section.',
  'sections.hints.buildGeotechFirst':
    'Build the geotech model for this section before suggesting NAD subdivision.',

  // Section context menus + gestures.
  'sections.menu.body': 'Body extent actions',
  'sections.menu.dissolveBody': 'Dissolve body',
  'sections.menu.nameBody': 'Name body…',
  'sections.menu.focusTest': 'Focus this test',
  'sections.menu.openDetail': 'Open detail',
  'sections.menu.removeFromSection': 'Remove from this section',
  'sections.menu.clearSubdivision': 'Clear subdivision',
  'sections.menu.deleteContact': 'Delete contact',
  'sections.menu.linkToGeology': 'Link to geology',
  'sections.menu.unlinkFromGeology': 'Unlink from geology',
  'sections.menu.editInGeology': 'Edit in Geology stage',
  'sections.menu.mergeLayers': 'Merge layers',
  'sections.menu.removeLithoUnit': 'Remove this litho unit',
  'sections.menu.addSuggestionHere': 'Add new suggestion here',
  'sections.menu.unitStatistics': 'Unit statistics…',
  'sections.menu.insertLayerHere': 'Insert layer here…',
  'sections.menu.editComposition': 'Edit composition…',
  'sections.menu.splitLayer': 'Split layer',
  'sections.menu.acceptLayer': 'Accept layer',
  'sections.menu.rejectLayer': 'Reject layer',
  'sections.menu.extendToNearest': 'Extend to nearest contacts',
  'sections.menu.ghostActions': 'Ghost layer actions',
  'sections.menu.boundaryActions': 'Boundary actions',
  'sections.menu.confirmTie': 'Confirm tie',
  'sections.menu.deleteCorrelation': 'Delete correlation',
  'sections.menu.inspectLensBody': 'Inspect lens body…',
  'sections.menu.editBodyAdmixtures': 'Edit admixtures for this body',
  'sections.menu.mergeBands': 'Merge bands',
  'sections.menu.mergeIntoSurrounding': 'Merge into surrounding band',
  'sections.menu.splitBand': 'Split band…',

  'sections.contacts.insertHint': 'Click to insert new layer here · right-click to remove',
  'sections.contacts.lithoContactHint':
    'Lithostratigraphic contact — dragging it moves the litho model',
  'sections.contacts.coupledHint': 'Coupled to geological contact — right-click to unlink',
  'sections.contacts.absorbHint':
    'Release here and the band below is absorbed into this unit. One boundary per drag — drag again to take the next.',
  'sections.contacts.absorbBlockedHint':
    'Stops short of the next lithostratigraphic contact — going further would delete the unit below. Subdivide it first, or edit it on the lithology axis.',
  'sections.contacts.deleteConfirm':
    'Delete this contact? This removes the boundary and any correlations touching it.',
  'sections.contacts.deleteLensConfirm':
    'Delete this lens? This removes the two correlations that define it.',
  'sections.contacts.copyFailed':
    'Could not copy any contacts to the target — see console for details.',

  'sections.bands.rightClickBoundary':
    'Right-click to place a new packing boundary or remove this band',
  'sections.bands.rightClickClass': "Right-click to set this band's NAD class by hand",
  'sections.bands.nothingToSnap':
    'Nothing to snap to on this column — a borehole carries no cone resistance, so there are no packing boundaries here.',
  'sections.bands.acceptGhosts': 'Accept these bands (divide this borehole)',
  'sections.bands.pressDivide': 'Press "Divide boreholes" to commit.',
  'sections.bands.setPackingClass': 'Set packing class',
  'sections.bands.movePackingBoundary': 'Move packing boundary',
  'sections.bands.splitPackingBand': 'Split packing band',
  'sections.bands.mergePackingBands': 'Merge packing bands',
  'sections.bands.absorbPackingLens': 'Absorb packing lens',
  'sections.bands.disconnectPackingBands': 'Disconnect packing bands',

  'sections.lens.candidate':
    'Lens candidate — no correlation on either neighbour. Pinch it out to claim it as a lens.',
  'sections.lens.pinchOutCandidate': 'Pinch-out lens candidate — this layer pinches out toward the neighbour',
  'sections.lens.name': 'Lens name',
  'sections.lens.namePlaceholder': 'e.g. Boom Klei lens #1',
  'sections.lens.nameDialogTitle': 'Name lens',
  'sections.lens.saveName': 'Save name',
  'sections.lens.namedKeptHint':
    'A named lens is kept: it survives "Delete all detected lenses" and the next body recompute.',
  'sections.lens.boundaryStyle': 'Boundary style',
  'sections.lens.boundaryStyleHint': 'How the lens boundary is drawn between its control nodes.',
  'sections.lens.presentAt': 'Present at',
  'sections.lens.absentAt': 'Absent at',
  'sections.lens.noAbsenceRecords': 'No absence records.',
  'sections.lens.promoteToManual':
    'Promote from inferred to manual — the inference engine will no longer overwrite this row',
  'sections.lens.companionTitle': 'Create perpendicular cross-section?',
  'sections.lens.companionBlurb':
    'A perpendicular cross-section through the lens centroid helps verify the lens really pinches out in both directions.',
  'sections.lens.companionSkip': 'No, skip',
  'sections.lens.perpendicularSection': 'Perpendicular section…',

  'sections.tie.accept': 'Accept tie',
  'sections.tie.reject': 'Reject tie',
  'sections.tie.proposed': 'Proposed tie-section — right-click to Accept or Reject',
  'sections.tie.keepFlagged': 'Keep them flagged',
  'sections.tie.flaggedBlurb':
    'Deleting is one step on the undo stack. While a mismatched tie waits for review it is drawn with a warning mark.',
  'sections.reviewFlag.correlateOneBand': 'Correlate → one band',
  'sections.reviewFlag.uncorrelatedClay': 'Uncorrelated clay',

  'sections.dem.groundSurface': 'Ground surface (DHMVII DTM)',
  'sections.vb.title': 'DOV virtuele boring',
  'sections.vb.toggleHint': 'Show / hide the DOV Virtuele Boring overlay controls',
  'sections.vb.loadingCatalogue': 'Loading catalogue…',
  'sections.vb.depthBelowSurface': 'm below surface',
  'sections.vb.full': 'Full',
  'sections.vb.off': 'Off',
  'sections.psd.noGrainSize': 'No grain-size test',
  'sections.psd.finerByWeight': '% finer by weight',
  'sections.psd.highlightBody': 'Click to highlight packing body',
} as const
