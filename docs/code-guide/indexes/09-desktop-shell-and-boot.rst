9. Desktop — the renderer shell and boot
========================================

.. CG-EXPLANATION-START id=intro

This group is the desktop window's own starting point and the frame that holds
everything else. ``main.tsx`` is where the web page's code begins running;
``App.tsx`` is the top component. The ``shell/`` files are the frame around every
working stage — the stage spine (the row of stage buttons), the toolbars, the
registry that knows which stage is which, and the shared shell state. The boot
hook (``hooks/useAppBoot``) waits for the engine to come up before the app tries
to use it.

Also here: the screens the user meets before real work begins — the licence /
activation dialog, the first-run onboarding overlay, and the update
notification — plus the ``i18n/`` translation tables that hold every piece of
English and Dutch text the interface shows. The individual working stages
themselves are read in groups 10 and 11.

.. CG-EXPLANATION-END id=intro

.. toctree::
   :maxdepth: 1

   ../pages/desktop.renderer.src.App
   ../pages/desktop.renderer.src.main
   ../pages/desktop.renderer.src.components.licensing.LicensingDialog
   ../pages/desktop.renderer.src.components.onboarding.OnboardingOverlay
   ../pages/desktop.renderer.src.components.updater.UpdateNotification
   ../pages/desktop.renderer.src.hooks.useAppBoot
   ../pages/desktop.renderer.src.i18n.i18n_constants
   ../pages/desktop.renderer.src.i18n.interpolateSlot
   ../pages/desktop.renderer.src.i18n.languageSelect
   ../pages/desktop.renderer.src.i18n.locales.en.chrome
   ../pages/desktop.renderer.src.i18n.locales.en.data
   ../pages/desktop.renderer.src.i18n.locales.en.index
   ../pages/desktop.renderer.src.i18n.locales.en.launch
   ../pages/desktop.renderer.src.i18n.locales.en.models
   ../pages/desktop.renderer.src.i18n.locales.en.outputs
   ../pages/desktop.renderer.src.i18n.locales.en.panels
   ../pages/desktop.renderer.src.i18n.locales.en.sections
   ../pages/desktop.renderer.src.i18n.locales.en.settings
   ../pages/desktop.renderer.src.i18n.locales.en.sheet
   ../pages/desktop.renderer.src.i18n.locales.en.tutorial
   ../pages/desktop.renderer.src.i18n.locales.nl.chrome
   ../pages/desktop.renderer.src.i18n.locales.nl.data
   ../pages/desktop.renderer.src.i18n.locales.nl.index
   ../pages/desktop.renderer.src.i18n.locales.nl.launch
   ../pages/desktop.renderer.src.i18n.locales.nl.models
   ../pages/desktop.renderer.src.i18n.locales.nl.outputs
   ../pages/desktop.renderer.src.i18n.locales.nl.panels
   ../pages/desktop.renderer.src.i18n.locales.nl.sections
   ../pages/desktop.renderer.src.i18n.locales.nl.settings
   ../pages/desktop.renderer.src.i18n.locales.nl.sheet
   ../pages/desktop.renderer.src.i18n.locales.nl.tutorial
   ../pages/desktop.renderer.src.i18n.translate
   ../pages/desktop.renderer.src.shell.AppShell
   ../pages/desktop.renderer.src.shell.EmptyState
   ../pages/desktop.renderer.src.shell.Inspector
   ../pages/desktop.renderer.src.shell.ResponsiveToolbarRow
   ../pages/desktop.renderer.src.shell.ShellContext
   ../pages/desktop.renderer.src.shell.StageCanvas
   ../pages/desktop.renderer.src.shell.StageDescriptor
   ../pages/desktop.renderer.src.shell.StageErrorBoundary
   ../pages/desktop.renderer.src.shell.StageRegistry
   ../pages/desktop.renderer.src.shell.StageSpine
   ../pages/desktop.renderer.src.shell.StageToolbar
   ../pages/desktop.renderer.src.shell.ToolbarPrimitives
   ../pages/desktop.renderer.src.shell.toolbarOverflow
   ../pages/desktop.renderer.src.shell.toolbarOverflow_constants
   ../pages/desktop.renderer.src.shell.useShellState
   ../pages/desktop.renderer.src.shell.useToolbarShortcuts

