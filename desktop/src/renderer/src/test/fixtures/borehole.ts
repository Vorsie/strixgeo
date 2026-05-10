import type {
  BoreholeDetailResponse,
  ObservationResponse,
  SampleResponse,
} from '../../api/client'

// Fixture borehole for snapshot / behaviour tests on BoreholeLog.
// Shape mirrors a representative DOV borehole: 3 drill segments, 2
// field-log streams, 1 main lithology observation with 3 layers, 2
// samples — one with grain-size + Atterberg, one with a scalar test.
// Numbers are arbitrary but internally consistent (depths in [0,
// total_depth_m]; layers contiguous; samples within their parent depth).

export function makeFixtureBorehole(): BoreholeDetailResponse {
  const layers = [
    {
      id: 'layer-0',
      top_m: 0,
      base_m: 1.5,
      color: 'bruin',
      main_soil_codes: ['ZF'],
      description: 'fine sand',
      layer_index: 0,
      admixtures: [{ soil_code: 'KL', amount: 'sporadisch', locally: false }],
    },
    {
      id: 'layer-1',
      top_m: 1.5,
      base_m: 3.2,
      color: 'grijs',
      main_soil_codes: ['KL'],
      description: 'plastic clay',
      layer_index: 1,
      admixtures: [],
    },
    {
      id: 'layer-2',
      top_m: 3.2,
      base_m: 5.0,
      color: null,
      main_soil_codes: ['ZG'],
      description: null,
      layer_index: 2,
      admixtures: [],
    },
  ]

  const lithology: ObservationResponse = {
    id: 'obs-litho',
    // Must match `LITHOLOGY_TYPES` in BoreholeLog so the layer block
    // renders soil-code badges + admixture chips (not the text-card
    // fallback used for `lithological_description` etc.).
    observation_type: 'coded_lithology',
    author: 'TEST',
    observation_date: '2024-01-15',
    reliability: 'A',
    score_category: 'goed',
    drill_method_score: 'A',
    layers,
  }

  const sampleA: SampleResponse = {
    id: 'sample-A',
    depth_top_m: 0.5,
    depth_base_m: 1.0,
    description: 'top sample',
    sample_number: 'M1',
    sample_type: 'roerend',
    composition: 'fine sand',
    instrument: 'pulse',
    sampling_date: '2024-01-15',
    grain_sizes: [
      {
        id: 'gs-A',
        diameters_mm: [0.063, 0.125, 0.25, 0.5, 1.0, 2.0],
        pct_larger: [98, 85, 60, 30, 10, 2],
        method: 'Zeving',
        test_date: '2024-01-20',
        lime_removed: false,
        organics_removed: false,
      },
    ],
    atterberg_limits_tests: [
      {
        id: 'at-A',
        liquid_limit_pct: 35,
        plastic_limit_pct: 20,
        non_plastic: false,
        method: null,
        test_date: '2024-01-21',
      },
    ],
    caco3_content_tests: [],
    organic_content_tests: [],
    water_content_tests: [],
    scalar_lab_tests: [],
  }

  const sampleB: SampleResponse = {
    id: 'sample-B',
    depth_top_m: 2.0,
    depth_base_m: 2.5,
    description: 'mid sample',
    sample_number: 'M2',
    sample_type: 'roerend',
    composition: 'plastic clay',
    instrument: 'pulse',
    sampling_date: '2024-01-15',
    grain_sizes: [],
    atterberg_limits_tests: [],
    caco3_content_tests: [],
    organic_content_tests: [],
    water_content_tests: [],
    scalar_lab_tests: [
      {
        id: 'sl-B',
        parameter_group: 'Onderkenning-grondsoort',
        parameter: 'Grondsoort volgens ASTM, de code',
        value_numeric: null,
        value_text: 'CL',
        unit: null,
        method: null,
        test_date: '2024-01-22',
        detection_condition: null,
      },
    ],
  }

  return {
    id: 'bh-fixture-1',
    name: 'BH-FIXTURE-1',
    test_id: 'TEST_001',
    project_id: 'DOV',
    location_x: 150000,
    location_y: 200000,
    epsg: 31370,
    elevation_m: 12.5,
    z_epsg: 5710,
    start_date: '2024-01-15',
    drill_method: 'spoelboring',
    borehole_type: 'verkenning',
    purpose: 'site investigation',
    municipality: 'Gent',
    executor: 'TEST_LAB',
    total_depth_m: 5.0,
    water_table_depth_m: 1.8,
    n_drill_segments: 3,
    n_field_log_intervals: 4,
    drill_segments: [
      { id: 'ds-0', top_m: 0, base_m: 2.0, method: 'spoelboring' },
      { id: 'ds-1', top_m: 2.0, base_m: 4.0, method: 'pulsboring' },
      { id: 'ds-2', top_m: 4.0, base_m: 5.0, method: 'spoelboring' },
    ],
    // ``kind`` must match the English-translated keys in
    // ``FieldLogTrack`` (``"color"``, ``"moisture"``, ``"consistency"``).
    // The Dutch source tokens ``"kleur"`` / ``"vochtgehalte"`` /
    // ``"consistentie"`` are translated upstream of the API response.
    field_log_intervals: [
      { id: 'fl-0', top_m: 0, base_m: 1.5, kind: 'color', value: 'bruin' },
      { id: 'fl-1', top_m: 1.5, base_m: 3.2, kind: 'color', value: 'grijs' },
      { id: 'fl-2', top_m: 0, base_m: 1.5, kind: 'moisture', value: 'droog' },
      { id: 'fl-3', top_m: 1.5, base_m: 5.0, kind: 'moisture', value: 'vochtig' },
    ],
    observations: [lithology],
    samples: [sampleA, sampleB],
  }
}

/**
 * Build a fixture with the FIRST layer's ``admixtures`` replaced by the
 * supplied list. Lets tests target the admixture-rendering surface
 * without touching the rest of the borehole.
 */
export function makeFixtureBoreholeWithAdmixtures(
  admixtures: { soil_code: string; amount: string; locally: boolean }[],
): BoreholeDetailResponse {
  const base = makeFixtureBorehole()
  const lithology = base.observations[0]
  const updatedLayers = lithology.layers.map((layer, i) =>
    i === 0 ? { ...layer, admixtures } : layer,
  )
  return {
    ...base,
    observations: [{ ...lithology, layers: updatedLayers }],
  }
}

/**
 * Build a fixture where the FIRST sample has no lab tests of any kind.
 * Lets tests target the SamplesTrack's "no tests" fallback rendering.
 */
export function makeFixtureBoreholeWithEmptySample(): BoreholeDetailResponse {
  const base = makeFixtureBorehole()
  const stripped = base.samples.map((s, i) =>
    i === 0
      ? {
          ...s,
          grain_sizes: [],
          atterberg_limits_tests: [],
          caco3_content_tests: [],
          organic_content_tests: [],
          water_content_tests: [],
          scalar_lab_tests: [],
        }
      : s,
  )
  return { ...base, samples: stripped }
}
