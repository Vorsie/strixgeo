// Sections stage canvas.
//
// Reproduces the ``selectedSection !== null ? <SectionPanel .../>`` branch
// from App.tsx at commit 3322e04^ verbatim, now sourcing every prop from the
// ShellContext bus via useShell() — exactly the pattern DataCanvas used for
// the map/chart/borelog branch.
//
// When no section is selected the canvas shows the project map so the user
// can see where to draw a new cross-section (same affordance as the Data
// stage — sections are spatial objects that start on the map).  The map
// renders in "section selection" mode: drawSectionMode wires the line-draw
// interaction, and onSelectSection highlights an existing section.
//
// The wrapped SectionPanel receives zero internal changes — all its props are
// wired from the bus.  The component never gains a direct prop; it reads from
// useShell() and delegates.

import { useMemo } from 'react'

import { useShell } from '../../ShellContext'
import SectionPanel from '../../../components/SectionPanel'
import MapView from '../../../components/MapView'

/**
 * Center canvas for the Sections stage.
 *
 * Renders ``SectionPanel`` when a section is selected; falls back to
 * ``MapView`` (section-draw mode) when nothing is selected so the user can
 * pick or draw a cross-section.
 *
 * All props are sourced from the ShellContext bus — no props are accepted
 * directly (matches the ``StageDescriptor.CanvasComponent`` contract).
 *
 * Returns
 * -------
 * JSX.Element
 *     The sections canvas element.
 */
export default function SectionsCanvas(): JSX.Element {
  const {
    project,
    visibleCpts,
    visibleBoreholes,
    geoModel: {
      activeGeologicalModel,
      formations,
      contacts,
      surfacesByFormationId,
      handleCreateContact,
      handleUpdateContactDepth,
      handleDeleteContact,
      handleBatchUpdateContacts,
      handleBatchCreateContacts,
      handleAutoPopulateFromStratigraphy,
      handleInlineCreateFormation,
    },
    sections: {
      sections,
      selectedSectionId,
      drawingSection,
      focusedContactIds,
      clearSectionSelection,
      handlePatchSelectedSection,
      handleSectionLineDrawn,
      cancelSectionDraw,
      handleSelectSection,
    },
    overlays: {
      virtueleBoringSectionModels,
      virtueleBoringPredictions,
      virtueleBoringOverlay,
      showOverlayOnSection,
      handleChangeVirtueleBoringPicker,
      handleSetShowOverlay,
      demSource,
      demOverlay,
      handleDemOverlayChange,
    },
    coordinator: {
      selectedId,
      selectedBoreholeId,
      handleSelect,
      handleSelectBorehole,
      handleExportSectionDxf,
    },
    mapState: {
      hiddenCptTypes,
      hiddenBoreholeValues,
      boreholeAxis,
      mapCameraRef,
      handleToggleCptType,
      handleToggleBoreholeValue,
      setBoreholeAxis,
      handleViewportChange,
      handleMapCameraChange,
    },
    investigations: {
      bboxImportType,
      cancelBboxDraw,
      handleBboxDrawn,
    },
  } = useShell()

  // Resolve the currently-selected section object from the id + list.
  // Mirrors the ``selectedSection`` memo in App.tsx at 3322e04^.
  const selectedSection = useMemo(
    () =>
      selectedSectionId ? sections.find(s => s.id === selectedSectionId) ?? null : null,
    [selectedSectionId, sections],
  )

  if (selectedSection !== null) {
    return (
      <SectionPanel
        section={selectedSection}
        zEpsg={project.default_vertical_epsg}
        cpts={visibleCpts}
        boreholes={visibleBoreholes}
        onPatch={handlePatchSelectedSection}
        onClose={clearSectionSelection}
        onSelectCpt={handleSelect}
        onSelectBorehole={handleSelectBorehole}
        contacts={contacts}
        formations={formations}
        surfacesByFormationId={surfacesByFormationId}
        focusedContactIds={focusedContactIds}
        excludedBoreholeIds={activeGeologicalModel?.excluded_borehole_ids ?? []}
        onCreateContact={handleCreateContact}
        onUpdateContactDepth={handleUpdateContactDepth}
        onDeleteContact={handleDeleteContact}
        onBatchUpdateContacts={handleBatchUpdateContacts}
        onBatchCreateContacts={handleBatchCreateContacts}
        onAutoPopulateFromStratigraphy={
          activeGeologicalModel ? handleAutoPopulateFromStratigraphy : undefined
        }
        onCreateFormation={handleInlineCreateFormation}
        onExportDxf={
          activeGeologicalModel
            ? () =>
                handleExportSectionDxf(
                  project.id,
                  selectedSection.id,
                  selectedSection.name,
                  activeGeologicalModel.id,
                )
            : undefined
        }
        virtueleBoringActiveModels={virtueleBoringSectionModels}
        virtueleBoringPredictions={virtueleBoringPredictions}
        virtueleBoringModelA={virtueleBoringOverlay.modelA}
        virtueleBoringModelB={virtueleBoringOverlay.modelB}
        virtueleBoringMaxDepthM={virtueleBoringOverlay.maxDepthM}
        virtueleBoringShowOnSection={showOverlayOnSection}
        onChangeVirtueleBoringPicker={handleChangeVirtueleBoringPicker}
        onChangeVirtueleBoringShowOnSection={next =>
          handleSetShowOverlay('section', next)
        }
      />
    )
  }

  // No section selected — show the map so the user can draw a new line
  // or click an existing section marker.  Bbox-draw props are threaded
  // through so DOV imports also work from the Sections stage.
  const drawingBbox = bboxImportType !== null

  return (
    <MapView
      cpts={visibleCpts}
      boreholes={visibleBoreholes}
      selectedCptId={selectedId}
      selectedBoreholeId={selectedBoreholeId}
      onSelectCpt={handleSelect}
      onSelectBorehole={handleSelectBorehole}
      hiddenCptTypes={hiddenCptTypes}
      hiddenBoreholeValues={hiddenBoreholeValues}
      boreholeAxis={boreholeAxis}
      onToggleCptType={handleToggleCptType}
      onToggleBoreholeValue={handleToggleBoreholeValue}
      onChangeBoreholeAxis={setBoreholeAxis}
      drawMode={drawingBbox}
      onBboxDrawn={handleBboxDrawn}
      onCancelDraw={cancelBboxDraw}
      onViewportChange={handleViewportChange}
      demSource={demSource}
      demOverlay={demOverlay}
      onDemOverlayChange={handleDemOverlayChange}
      drawSectionMode={drawingSection}
      onSectionLineDrawn={handleSectionLineDrawn}
      onCancelSectionDraw={cancelSectionDraw}
      sections={sections}
      selectedSectionId={selectedSectionId}
      onSelectSection={handleSelectSection}
      initialCenter={mapCameraRef.current?.center}
      initialZoom={mapCameraRef.current?.zoom}
      onCameraChange={handleMapCameraChange}
    />
  )
}
