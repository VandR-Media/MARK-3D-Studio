import bpy, os, json
OUT=os.path.abspath("output")
os.makedirs(OUT,exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=os.path.abspath("human.glb"))
a=[o for o in bpy.data.objects if o.type=="ARMATURE"]
m=[o for o in bpy.data.objects if o.type=="MESH"]
print("MAKEHUMAN_IMPORT",len(a),len(m), flush=True)
info={"rigs":[{"name":o.name,"bones":[b.name for b in o.data.bones],"location":list(o.location),"scale":list(o.scale)} for o in a],
"meshes":[{"name":o.name,"vertices":len(o.data.vertices),"faces":len(o.data.polygons),
"bounds":[list(map(float,x)) for x in o.bound_box],"parent":o.parent.name if o.parent else None,
"modifiers":[x.type for x in o.modifiers]} for o in m],
"actions":[o.name for o in bpy.data.actions]}
with open(os.path.join(OUT,"probe.json"),"w") as f:json.dump(info,f,indent=2)
print("MAKEHUMAN_INFO",json.dumps(info)[:6000],flush=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,"human_probe.blend"))
