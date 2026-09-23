# Walking character

`rogue.glb` is the Rogue from **KayKit Character Pack: Adventurers 1.0** by
Kay Lousberg (www.kaylousberg.com), CC0 licensed (see `LICENSE.txt`), from
https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0
(`Characters/gltf/Rogue.glb`).

It is trimmed from 3.5 MB to ~0.6 MB with

```
node tools/trim-character.mjs Rogue.glb assets/human/rogue.glb
```

which keeps only the animations the game uses (Idle, Walking_A,
Walking_Backwards, Running_A, Jump_Start/Idle/Land, Cheer, Interact) and
drops the weapon props (knives, crossbows, throwable).
