import bpy, json, os, math
from pathlib import Path
from mathutils import Vector
out=Path("output");out.mkdir(exist_ok=True)
bpy.ops.object.select_all(action="SELECT");bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(Path("teen_rigged.glb").absolute()))
meshes=[o for o in bpy.data.objects if o.type=="MESH"]
rigs=[o for o in bpy.data.objects if o.type=="ARMATURE"]
def bbox(o):return [list(v) for v in o.bound_box]
info={"meshes":[{"name":o.name,"vertices":len(o.data.vertices),"polygons":len(o.data.polygons),"parent":o.parent.name if o.parent else "",
"materials":[m.name if m else None for m in o.data.materials], "position":list(o.location),"bbox":bbox(o)} for o in meshes],
"rigs":[{"name":o.name,"bones":[b.name for b in o.data.bones],"heads":{b.name:list(b.head_local) for b in o.data.bones}} for o in rigs],
"actions":[a.name for a in bpy.data.actions]}
(out/"inspect.json").write_text(json.dumps(info,indent=2))
print("V5_PROBE_MESHES",len(meshes),"rigs",len(rigs),"bones",len(rigs[0].data.bones) if rigs else 0,flush=True)
world=bpy.context.scene.world
world.use_nodes=True
world.node_tree.nodes["Background"].inputs["Color"].default_value=(.22,.23,.3,1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value=.7
def area(n,pos,power,color,size):
    d=bpy.data.lights.new(n,"AREA");d.energy=power;d.color=color;d.shape="DISK";d.size=size
    ob=bpy.data.objects.new(n,d);bpy.context.collection.objects.link(ob)
    ob.location=pos;ob.rotation_euler=(Vector((0,0,1.0))-ob.location).to_track_quat("-Z","Y").to_euler()
area("Key",(-3,-3,5),950,(1,.91,.85),4)
area("Fill",(3,-2,4),550,(.48,.83,1),3.5)
area("Rim",(3,3,4.5),700,(1,.3,.8),3)
for o in bpy.data.objects:
    if o.type=="ARMATURE":
        o.animation_data_clear()
for o in bpy.data.objects:
    if o.animation_data:o.animation_data_clear()
bpy.context.scene.frame_set(1)
def camera(n,p):
    d=bpy.data.cameras.new(n);d.type="ORTHO";d.ortho_scale=2.45
    o=bpy.data.objects.new(n,d);bpy.context.collection.objects.link(o);o.location=p
    o.rotation_euler=(Vector((0,0,1.0))-o.location).to_track_quat("-Z","Y").to_euler()
    bpy.context.scene.camera=o
bpy.context.scene.render.engine="CYCLES";bpy.context.scene.cycles.samples=12
bpy.context.scene.render.resolution_x=520;bpy.context.scene.render.resolution_y=700
bpy.context.scene.render.resolution_percentage=100
bpy.context.scene.view_settings.view_transform="AgX"
for name,p in [("front",(0,-4.5,1.7)),("side",(4.5,0,1.7)),("back",(0,4.5,1.7))]:
    camera(name,p)
    bpy.context.scene.render.filepath=str((out/("source_"+name+".png")).absolute())
    bpy.ops.render.render(write_still=True)
print("V5_SOURCE_PROBE_COMPLETE",flush=True)
