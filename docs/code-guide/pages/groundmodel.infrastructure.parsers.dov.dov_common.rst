groundmodel.infrastructure.parsers.dov.dov_common
=================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/dov/dov_common.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/dov/dov_common.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-63

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_common.py
   :language: python
   :lines: 1-63
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Holds the fixed values every DOV client shares — the source tag stamped on DOV records, the WFS web address, the allow-listed DOV host, the feature-count cap and recursion depth, the import-size guards, the retry statuses and delays, and the coordinate transformer — and imports the small libraries those need.

**Why it is here.** The project keeps constants in a dedicated file rather than scattered at the tops of the code files, so a value is changed in one place. Two of these carry real weight. The allow-listed host is derived from the WFS address so the one real DOV host is stated once; any URL that is not on that host is refused before it is ever fetched. And the coordinate transformer is built once here and reused, because building it is expensive and it is safe to share.

.. CG-EXPLANATION-END id=module-header

Function ``def is_allowed_dov_url``
-----------------------------------

.. CG-BLOCK id=function:is_allowed_dov_url lines=64-86

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_common.py
   :language: python
   :lines: 64-86
   :lineno-match:

.. CG-EXPLANATION-START id=function:is_allowed_dov_url

**What this does.** Returns true only when a URL uses http or https and points at an allow-listed DOV host. Everything else — another host, a URL with no host, an odd scheme like ``file://`` — returns false.

**Why it is here.** The URLs the client fetches are partly built from data DOV sends back, which is not fully trusted (a doctored or tampered-with response could name any host). Checking every such URL here, before it is fetched, is the guard against a response steering the app into fetching an internal address it should never touch — the server-side request forgery (SSRF) guard.

.. CG-EXPLANATION-END id=function:is_allowed_dov_url

Module-level constants and statements
-------------------------------------

.. CG-BLOCK id=module-statements lines=87-171

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_common.py
   :language: python
   :lines: 87-171
   :lineno-match:

.. CG-EXPLANATION-START id=module-statements

**What this does.** More shared constants: the cap on features per WFS reply and the recursive-split depth limit, the import-size guards (the largest rectangle side and area a single import may cover, and the hard ceiling on how many features one import may discover), and the pattern used to read the match-count out of a WFS reply.

**Why it is here.** These bounds keep a mis-drawn or hostile request from fanning out into thousands of downloads. A rectangle bigger than 625 square kilometres, or an import that would discover more than 2000 features, is refused up front. The comments record that the owner may retune these numbers, and why each was set where it is.

.. CG-EXPLANATION-END id=module-statements

Function ``def cql_bbox_predicate``
-----------------------------------

.. CG-BLOCK id=function:cql_bbox_predicate lines=172-183

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_common.py
   :language: python
   :lines: 172-183
   :lineno-match:

.. CG-EXPLANATION-START id=function:cql_bbox_predicate

**What this does.** Builds a little text snippet that expresses "inside this rectangle" in the query language DOV understands (CQL), for use when the request also needs to filter on an attribute.

**Why it is here.** DOV refuses a request that carries both a separate rectangle parameter and an attribute filter — the two are mutually exclusive on its server. So when an attribute filter is needed, the rectangle has to be folded into the same filter string; this builds that piece. The comment records that DOV changed this rule without warning in 2026, which is why the lesson is captured in the code.

.. CG-EXPLANATION-END id=function:cql_bbox_predicate

Function ``def validate_wgs84_import_bbox``
-------------------------------------------

.. CG-BLOCK id=function:validate_wgs84_import_bbox lines=184-246

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_common.py
   :language: python
   :lines: 184-246
   :lineno-match:

.. CG-EXPLANATION-START id=function:validate_wgs84_import_bbox

**What this does.** Checks an import rectangle before anything is fetched. It rejects a rectangle whose edges are reversed or zero-width, naming the wrong pair of edges, and rejects one whose real ground area exceeds the import limit, naming the limit. It raises a clear error that the web layer turns into a polite refusal.

**Why it is here.** The four corners come straight from the user's draw gesture and would otherwise drive the whole recursive download. Checking the area in real projected metres, not in raw degrees, matters because a degree of longitude in Belgium is about 70 km wide, not 111 — so a degree-based check would misjudge the size. This catches a continent-sized or back-to-front box the moment it arrives.

.. CG-EXPLANATION-END id=function:validate_wgs84_import_bbox

Module-level constants and statements
-------------------------------------

.. CG-BLOCK id=module-statements~2 lines=247-267

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_common.py
   :language: python
   :lines: 247-267
   :lineno-match:

.. CG-EXPLANATION-START id=module-statements~2

**What this does.** The last shared constants: the two DOV XML namespaces (the schema namespace and the GML coordinate namespace), a ready-made tag prefix built from the GML one, and the strict pattern a cache permkey must match.

**Why it is here.** A quirk worth pinning: DOV's schema namespace sits only on the very top element, so its children are in no namespace at all and can be found by bare tag name, while GML coordinate elements really are namespaced and need the prefix. The permkey pattern allows only letters, digits, and a few punctuation marks, so a malformed key can never use path tricks to escape the cache folder — and it uses true start/end anchors so a multi-line value cannot slip past it.

.. CG-EXPLANATION-END id=module-statements~2

