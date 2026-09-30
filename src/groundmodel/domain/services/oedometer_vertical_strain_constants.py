"""Constants for the oedometer vertical-strain derivation."""

# The formula recorded on every derived strain channel (Data Integrity §1:
# a derived value carries how it was made). delta_h = cumulative settlement
# since the start of the test; h0 = initial specimen height.
VERTICAL_STRAIN_FORMULA = "epsilon_v = delta_h / h0"
# Canonical channel key and unit of the derived channel. Dimensionless (a
# fraction, not %) so no factor hides in the stored number.
VERTICAL_STRAIN_CHANNEL_KEY = "vertical_strain"
VERTICAL_STRAIN_UNIT = "-"
