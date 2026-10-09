# WordMate macOS adapter

Derived from Qingjian c08ae57 under GPL-3.0-or-later. See [provenance](../../NOTICE.md).

The adapter handles IMK events and a nonactivating candidate panel. The additional action panel adopts only the current candidate fragment. Model credentials and notebook access remain in WordMate desktop. English is the only learning language; Chinese/English input and output remain supported.

Build from the repository root: `python3 input-method/scripts/build.py`. Runtime bundle identity is com.qiji.wordmate.inputmethod; user input settings/learning data are under Application Support/WordMateInput, separate from both Qingjian and the desktop WordMate notebook.
