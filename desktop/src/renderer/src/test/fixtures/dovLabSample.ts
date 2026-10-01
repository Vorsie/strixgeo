// One DOV sample as the owner saw it in the track editor's reference pane on
// 2026-10-01 ("this is too verbose, also make a combined sieve + hydrometer
// graph"): a sieve test + a hydrometer test, and the eight catch-all scalar
// rows with their raw DOV parameter tokens copied verbatim from
// ``dov_constants.py`` (doubled-tail form included).
import type { SampleResponse, ScalarLabTestResponse } from '../../api/clients/borehole'

function scalar(
  id: string,
  parameterGroup: string,
  parameter: string,
  value: number | string,
  unit: string | null,
): ScalarLabTestResponse {
  return {
    id,
    parameter_group: parameterGroup,
    parameter,
    value_numeric: typeof value === 'number' ? value : null,
    value_text: typeof value === 'string' ? value : null,
    unit,
    method: null,
    test_date: null,
    detection_condition: null,
  }
}

/** The owner's sample: 2 grain-size tests + the 8 scalar rows he saw. */
export function makeOwnerDovLabSample(): SampleResponse {
  return {
    id: 'sample-owner',
    depth_top_m: 3,
    depth_base_m: 3.5,
    description: '',
    sample_number: '2024-401424',
    sample_type: null,
    composition: null,
    instrument: null,
    sampling_date: null,
    geotech_body_id: null,
    geotech_nad_class: null,
    geotech_assignment_source: null,
    grain_sizes: [
      {
        id: 'gs-sieve',
        diameters_mm: [0.063, 0.125, 0.25, 0.5, 1, 2, 4],
        pct_larger: [88, 70, 40, 20, 10, 5, 0],
        method: 'Zeving',
        test_date: null,
        lime_removed: null,
        organics_removed: null,
      },
      {
        id: 'gs-hydrometer',
        diameters_mm: [0.002, 0.006, 0.02, 0.063],
        pct_larger: [97, 95, 92, 88],
        method: 'Hydrometer',
        test_date: null,
        lime_removed: null,
        organics_removed: null,
      },
    ],
    atterberg_limits_tests: [],
    caco3_content_tests: [],
    organic_content_tests: [],
    water_content_tests: [],
    scalar_lab_tests: [
      scalar('s1', 'Volumemassa-watergehalte ', 'Volumemassa nat (volumemassa nat)', 2.1, 't/m³'),
      scalar(
        's2',
        'Onderkenning-grondsoort',
        'Grondsoort volgens ASTM, de beschrijving (ASTM_naam)',
        'Well-graded sand with silt',
        null,
      ),
      scalar('s3', 'Onderkenning-grondsoort', 'Grondsoort volgens ASTM, de code (ASTM_code)', 'SW-SM', null),
      scalar(
        's4',
        'Onderkenning - proeven',
        'Gehalte Kalkachtige stoffen (Gehalte Kalkachtige stoffen)',
        1.8,
        '%',
      ),
      scalar(
        's5',
        'Onderkenning - proeven',
        'Gehalte Organische stoffen (Gehalte Organische stoffen)',
        0.1,
        '%',
      ),
      scalar('s6', 'Volumemassa-watergehalte ', 'Korrelvolumemassa (korrelvolumemassa)', 2.65, 't/m³'),
      scalar('s7', 'Onderkenning-grondsoort', 'Grondsoort volgens BGGG norm (Grondsoort BGGG)', 'grofzand', null),
      scalar('s8', 'Volumemassa-watergehalte ', 'Watergehalte (watergehalte)', 16.8, '%'),
    ],
  }
}
