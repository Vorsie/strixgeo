// Geology stage canvas — 2D plan view using MapView in read-only mode.
//
// Phase G2: replaces the "coming soon" placeholder with a real MapView.
// The map renders all investigations in geographic context but with NO
// investigation-selection wiring — the Geology stage is not the
// data-inspection surface (that is the Data stage). Clicking a CPT or
// borehole marker does nothing here.
//
// Phase G5+ replaces this with a Cesium 3D viewer when at least one
// non-stale surface exists, falling back to this 2D view when no surfaces
// are present. The read-only MapView remains the fallback indefinitely.

import { useShell } from '../../ShellContext'
import MapView from '../../../components/MapView'

/**
 * Center canvas for the Geology stage.
 *
 * Renders a read-only ``MapView`` showing all investigations in geographic
 * context.  Investigation clicks are intentionally unwired — the Geology
 * stage is the model-definition surface; the Data stage is the inspection
 * surface.  Bbox draw and section draw modes are also disabled here.
 *
 * All props are sourced from the ShellContext bus (``useShell()``) — no
 * props are accepted directly (matches the ``StageDescriptor.CanvasComponent``
 * contract).
 *
 * Returns
 * -------
 * JSX.Element
 *     The geology canvas element.
 */
export default function GeologyCanvas(): JSX.Element {
  const {
    visibleCpts,
    visibleBoreholes,
    sections: { sections },
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
    overlays: {
      demSource,
      demOverlay,
      handleDemOverlayChange,
    },
  } = useShell()

  return (
    <MapView
      cpts={visibleCpts}
      boreholes={visibleBoreholes}
      // Read-only: no investigation selection in the Geology stage.
      // The Geology stage is for model definition, not data inspection.
      // Users switch to the Data stage to view CPT charts / borelogs.
      selectedCptId={null}
      selectedBoreholeId={null}
      onSelectCpt={() => {}}
      onSelectBorehole={() => {}}
      hiddenCptTypes={hiddenCptTypes}
      hiddenBoreholeValues={hiddenBoreholeValues}
      boreholeAxis={boreholeAxis}
      onToggleCptType={handleToggleCptType}
      onToggleBoreholeValue={handleToggleBoreholeValue}
      onChangeBoreholeAxis={setBoreholeAxis}
      // No bbox draw — imports live in the Data stage toolbar.
      drawMode={false}
      onViewportChange={handleViewportChange}
      sections={sections}
      // Persist the map camera so navigating away and back restores
      // the user's last frame (same as Data stage behaviour).
      initialCenter={mapCameraRef.current?.center}
      initialZoom={mapCameraRef.current?.zoom}
      onCameraChange={handleMapCameraChange}
      demSource={demSource}
      demOverlay={demOverlay}
      onDemOverlayChange={handleDemOverlayChange}
    />
  )
}
