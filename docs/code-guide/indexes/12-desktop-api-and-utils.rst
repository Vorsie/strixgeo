12. Desktop — API clients, hooks, components and utils
======================================================

.. CG-EXPLANATION-START id=intro

This group is the desktop app's toolbox — the shared parts every stage draws on.
The **API clients** (``api/``) are the typed functions the window uses to talk
to the Python engine over the local HTTP connection: one function per engine
endpoint, so a stage never builds a raw request by hand. The **hooks**
(``hooks/``) are the React building blocks that hold and refresh state (the
open project, the geological model, the current selection). The **utils**
(``utils/``) are pure helper functions — projections, colour lookups,
formatters, geometry maths — and the remaining shared **components** (the
borelog, the map library, common UI pieces) live here too.

Because these are the widely-reused pieces, this is a large group. It is the
right place to look when you want to know *how* a stage does something it did not
implement itself.

.. CG-EXPLANATION-END id=intro

.. toctree::
   :maxdepth: 1


