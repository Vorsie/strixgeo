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


