/**
 * Interpretation pane — sidebar surface for the geological model.
 *
 * Phase 4 v1.0 commercial MVP gate is built around this pane: the
 * user manages a per-project geological model (formations + per-
 * investigation contacts + geotech subdivision), the cross-section
 * panel becomes the editing surface, and the resulting layer
 * geometry feeds the DXF / Plaxis exporters.
 *
 * v0 (this turn): scaffold + slice plan. Shows the upcoming
 * editor's shape so the user can see where the pane is heading.
 * v1 (next): formations vocabulary management.
 * v2: contacts on the cross-section.
 * v3: click-to-place contact + edit / delete.
 * v4: geotech subdivision.
 */

import { Layers } from 'lucide-react'

export default function InterpretationPane(): JSX.Element {
  return (
    <div className="flex flex-col gap-3 px-3 py-4">
      <div className="flex items-center gap-2 text-gray-700">
        <Layers size={14} className="text-amber-700" />
        <span className="text-xs font-medium">Ground model</span>
      </div>

      <p className="text-[11px] text-gray-500 leading-snug">
        Per-project geological model. Define formations, drop contacts
        on cross-sections, subdivide into geotechnical units, export
        the layer geometry to DXF / Plaxis.
      </p>

      <div className="text-[10px] uppercase tracking-wide text-gray-400 font-medium mt-2">
        Coming in this slice
      </div>
      <ul className="text-[11px] text-gray-600 space-y-1.5">
        <li className="flex gap-1.5">
          <span className="text-gray-300">1.</span>
          <span>
            Formations vocabulary — name, colour, optional regional reference
            (e.g. <em>Boom Klei</em>, <em>Diest Zand</em>).
          </span>
        </li>
        <li className="flex gap-1.5">
          <span className="text-gray-300">2.</span>
          <span>
            Active geological model — one per project, with a list of
            formation contacts per investigation.
          </span>
        </li>
        <li className="flex gap-1.5">
          <span className="text-gray-300">3.</span>
          <span>
            Cross-section overlay — existing contacts render as
            horizontal lines, interpolated between investigations.
          </span>
        </li>
        <li className="flex gap-1.5">
          <span className="text-gray-300">4.</span>
          <span>
            Click a borehole&apos;s lithology strip at a depth to drop
            a formation top there.
          </span>
        </li>
        <li className="flex gap-1.5">
          <span className="text-gray-300">5.</span>
          <span>
            Gap validator — flags missing surface contact, duplicate
            depths, contacts below test depth.
          </span>
        </li>
        <li className="flex gap-1.5">
          <span className="text-gray-300">6.</span>
          <span>
            Geotechnical subdivision — split each formation into one
            or more geotech units (structure only in v1.0).
          </span>
        </li>
      </ul>

      <div className="text-[10px] text-gray-400 italic mt-2">
        The data layer is already in place — formation / model /
        contact / unit CRUD endpoints all live behind
        <code className="text-[10px] mx-1 px-1 bg-gray-100 rounded">
          /projects/{`{pid}`}/geology/*
        </code>
        . Editor UI lands next.
      </div>
    </div>
  )
}
