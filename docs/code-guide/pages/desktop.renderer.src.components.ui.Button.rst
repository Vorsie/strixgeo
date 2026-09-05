desktop.renderer.src.components.ui.Button
=========================================

.. CG-PAGE source=desktop/src/renderer/src/components/ui/Button.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/ui/Button.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-14

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/Button.tsx
   :language: tsx
   :lines: 1-14
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's opening comment and its two imports. The comment lists the four looks the button can take — primary (a filled accent button), secondary (a bordered surface button), danger (a red destructive button) and ghost (text only) — and records that the focus outline uses the ``ring-accent`` colour. It then imports ``forwardRef`` from React and two type-only helpers, ``ButtonHTMLAttributes`` and ``ReactNode``.

**Why it is here.** This is the app's one shared button — a *component*, meaning a reusable piece of on-screen interface written as a function that returns what to draw. Every dialog and side panel draws its buttons through this single file, so the look, spacing and focus behaviour are decided in one place instead of copied into every screen. The comment explains the one non-obvious colour choice: the earlier blue focus ring measured about 2.8:1 against dark backgrounds, which fails the WCAG 2.2 AA rule that an interface element must contrast at least 3:1 with what is behind it; ``ring-accent`` resolves to a blue that clears 3:1 in both the light and the dark theme. ``forwardRef`` is imported because a parent screen sometimes needs to reach inside and focus this button — explained on the component block below.

.. CG-EXPLANATION-END id=module-header

``type Variant``
----------------

.. CG-BLOCK id=type:Variant lines=15-15

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/Button.tsx
   :language: tsx
   :lines: 15-15
   :lineno-match:

.. CG-EXPLANATION-START id=type:Variant

**What this does.** Declares a name, ``Variant``, standing for one of exactly four words: ``'primary'``, ``'secondary'``, ``'danger'`` or ``'ghost'``.

**Why it is here.** This is a *type alias* — a short name for a data shape — and the ``a | b | c`` form is a *union*, meaning the value must be one of the listed words and nothing else. Naming the four allowed looks once lets the type-checker reject a typo like ``'primry'`` before the app ever runs, so a caller can never ask for a button style that does not exist.

.. CG-EXPLANATION-END id=type:Variant

``type Size``
-------------

.. CG-BLOCK id=type:Size lines=16-17

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/Button.tsx
   :language: tsx
   :lines: 16-17
   :lineno-match:

.. CG-EXPLANATION-START id=type:Size

**What this does.** Declares a second name, ``Size``, standing for one of two words: ``'sm'`` (small) or ``'md'`` (medium).

**Why it is here.** The same union idea as ``Variant`` above: the button comes in exactly two sizes, and spelling the choice out as a type means only ``'sm'`` or ``'md'`` can be passed.

.. CG-EXPLANATION-END id=type:Size

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=18-26

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/Button.tsx
   :language: tsx
   :lines: 18-26
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** Describes the inputs the button accepts: an optional ``variant`` (one of the four looks), an optional ``size`` (one of the two sizes) and ``children`` (the label content shown inside the button). It also inherits every standard HTML button input — things like ``onClick``, ``disabled`` and ``type`` — by extending ``ButtonHTMLAttributes``.

**Why it is here.** The inputs passed into a component are called its *props*, and an *interface* is a note listing which props a component carries, checked before the app runs and then gone. Inheriting the standard button attributes means a caller can hand this component any ordinary button property (an ``onClick`` handler, a ``disabled`` flag) without this file having to list each one — it only adds the three that are special to it. The question mark on ``variant`` and ``size`` marks them optional, so a caller may leave them off and take the defaults.

.. CG-EXPLANATION-END id=interface:Props

``const BASE``
--------------

.. CG-BLOCK id=const:BASE lines=27-28

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/Button.tsx
   :language: tsx
   :lines: 27-28
   :lineno-match:

.. CG-EXPLANATION-START id=const:BASE

**What this does.** A fixed string of styling classes shared by every button regardless of its variant — the layout (centred content with a small gap), the rounded corners, the medium-weight text, a smooth colour transition, the focus outline, and the dimmed, click-through look when the button is disabled.

**Why it is here.** These are the traits every button has in common, so they live in one constant instead of being repeated inside each of the four variants. The comment above it re-states the focus-ring reasoning from the header: ``ring-accent`` resolves through a CSS colour variable to a blue that clears the WCAG 2.2 AA 3:1 contrast rule against both the light and the dark background.

.. CG-EXPLANATION-END id=const:BASE

``const VARIANTS``
------------------

.. CG-BLOCK id=const:VARIANTS lines=29-38

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/Button.tsx
   :language: tsx
   :lines: 29-38
   :lineno-match:

.. CG-EXPLANATION-START id=const:VARIANTS

**What this does.** A lookup table pairing each of the four variant names with the styling classes that give it its distinct look: ``primary`` is an accent fill, ``danger`` is a red fill, ``secondary`` is a bordered surface, and ``ghost`` is plain text that tints on hover.

**Why it is here.** ``Record<Variant, string>`` forces this table to hold an entry for every one of the four variant names and no others, so a new variant can never be added to the type list without also giving it a look here. The comments record why ``secondary`` and ``ghost`` are written with semantic surface tokens (``bg-surface-page``, ``text-text-primary``): those tokens already carry the right colour for the light and the dark theme, so the buttons adapt to dark mode automatically instead of needing a separate dark-mode rule written at every place a button is used.

.. CG-EXPLANATION-END id=const:VARIANTS

``const SIZES``
---------------

.. CG-BLOCK id=const:SIZES lines=39-65

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/Button.tsx
   :language: tsx
   :lines: 39-65
   :lineno-match:

.. CG-EXPLANATION-START id=const:SIZES

**What this does.** A second lookup table giving the padding and text size for each of the two sizes — ``sm`` is tighter with extra-small text, ``md`` is roomier with small text — followed by the button's documentation comment, which spells out each input (``variant``, ``size``, ``children``, and the forwarded ``ref``) and what the component returns.

**Why it is here.** Splitting the size classes out mirrors the variant table: the button's final appearance is assembled from one base style plus one variant plus one size, each chosen from its own small table. The documentation comment is the numpy-style docstring the project's Definition of Done requires on every public component, and it notes the one subtle input — the ``ref`` is forwarded so a caller can focus the button, for example to put the initial focus on Cancel in a confirmation dialog.

.. CG-EXPLANATION-END id=const:SIZES

``const Button``
----------------

.. CG-BLOCK id=const:Button lines=66-80

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/Button.tsx
   :language: tsx
   :lines: 66-80
   :lineno-match:

.. CG-EXPLANATION-START id=const:Button

**What this does.** The button component itself. It reads its inputs — defaulting ``variant`` to ``secondary`` and ``size`` to ``sm`` when the caller omits them — joins the base, variant and size styling strings (plus any extra classes the caller passed) into one ``className``, and draws a real HTML ``<button>`` carrying that class, the caller's remaining button properties, and the label content inside. It is wrapped in ``forwardRef`` so the button element can be handed back to the parent.

**Why it is here.** This is what makes the button a *reusable UI primitive*: a single small component that every screen composes its buttons from, so a change to the look or the focus behaviour is made once here and appears everywhere. ``forwardRef`` lets a parent reach the underlying ``<button>`` element — ordinarily a component hides its internal element, but a confirmation dialog needs to move keyboard focus onto its Cancel button, and that requires a direct handle to the element. The defaults (``secondary`` / ``sm``) make the plainest call — just a label — produce a sensible everyday button.

.. CG-EXPLANATION-END id=const:Button

``default default``
-------------------

.. CG-BLOCK id=default:default lines=81-81

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/Button.tsx
   :language: tsx
   :lines: 81-81
   :lineno-match:

.. CG-EXPLANATION-START id=default:default

**What this does.** Makes ``Button`` the file's default export, so other files load it with ``import Button from '…/Button'``.

**Why it is here.** One class or component per file is the project convention, and exporting it as the default gives every screen a single, stable import path for the shared button.

.. CG-EXPLANATION-END id=default:default

