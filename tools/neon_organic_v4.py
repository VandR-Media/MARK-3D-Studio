"""NEON BOY V4: organic, textured, 53-bone skinned character.
Uses source organic MakeHuman-format GLB. Authoring mesh does NOT use primitive
objects for face, anatomy, hoodie sleeves or pants; clothes duplicate and deform
the source topology and inherit its vertex weights.
"""
import bpy, bmesh, math, os, json, struct, random
from math import sin, cos, pi, sqrt
from mathutils import Vector
from pathlib import Path
O=Path("output");O.mkdir(exist_ok=True)
random.seed(21)
bpy.ops.object.select_all(action="SELECT");bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(Path("human.glb").absolute()))
body=next(o for o in bpy.data.objects if o.type=="MESH" and len(o.data.vertices)>10000)
rig=next(o for o in bpy.data.objects if o.type=="ARMATURE")
body.name="Human_Organic_Original"; rig.name="NeonBoy_53_Bone_Rig"
for o in list(bpy.data.objects):
    if o.type=="MESH" and o is not body: bpy.data.objects.remove(o,do_unlink=True)
# Remove preexisting actions so glTF can export a single deterministic dance clip.
for o in bpy.data.objects:
    if o.animation_data: o.animation_data_clear()
for a in list(bpy.data.actions):bpy.data.actions.remove(a)
objs=[]
def hex_rgba(h):
    return tuple(int(h[i:i+2],16)/255 for i in (1,3,5))+(1,)
def pbr(name,color,metal=0,rough=.7,emit=0):
    m=bpy.data.materials.new(name);m.use_nodes=True;m.diffuse_color=hex_rgba(color)
    b=m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value=hex_rgba(color)
    b.inputs["Metallic"].default_value=metal;b.inputs["Roughness"].default_value=rough
    if emit:
        b.inputs["Emission Color"].default_value=hex_rgba(color)
        b.inputs["Emission Strength"].default_value=emit
    return m
mat={
    "hoodie":pbr("01 / Midnight cotton hoodie","#17182B",rough=.92),
    "hoodie_trim":pbr("02 / Dark navy rib knit","#101324",rough=.9),
    "seam":pbr("03 / Muted navy stitching","#3A3E59",rough=.92),
    "pants":pbr("04 / Charcoal grey cargo twill","#3C3E4B",rough=.94),
    "pants2":pbr("05 / Reinforced cargo pocket","#474957",rough=.89),
    "jean_seam":pbr("06 / Grey thread","#6B6E7F",rough=.9),
    "cap":pbr("07 / Crimson cotton twill","#B80932",rough=.91),
    "cap_dark":pbr("08 / Cap seam shadow","#7D1029",rough=.87),
    "hair":pbr("09 / Chocolate brown short hair","#231B20",rough=.84),
    "skin":pbr("10 / Warm child skin","#E8B291",rough=.81),
    "white":pbr("11 / Off-white textile","#DBDFE9",rough=.7),
    "shoe":pbr("12 / Matte navy technical polymer","#222840",rough=.66),
    "sole":pbr("13 / Soft white rubber","#DCE2EB",rough=.83),
    "sole_dark":pbr("14 / Carbon tread","#161921",rough=.89),
    "steel":pbr("15 / Satin graphite metal","#485369",metal=.66,rough=.27),
    "cup":pbr("16 / Headphone matte shell","#12172C",metal=.18,rough=.42),
    "earpad":pbr("17 / Leather headphone pad","#1C1B29",rough=.83),
    "cyan":pbr("18 / Cyan LED","#16CAFF",rough=.32,emit=2.1),
    "pink":pbr("19 / Magenta LED","#FE48D3",rough=.35,emit=1.9),
    "lightcyan":pbr("20 / Front print cyan","#52F3FF",emit=.85),
    "lightpink":pbr("21 / Front print magenta","#FF70D2",emit=.85),
}
def fresh(n,vs,faces,material,skinned=None):
    mesh=bpy.data.meshes.new(n+"_geo");mesh.from_pydata(vs,[],faces);mesh.update()
    obj=bpy.data.objects.new(n,mesh);bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat[material] if isinstance(material,str) else material)
    for p in obj.data.polygons:p.use_smooth=True
    if skinned:
        vg=obj.vertex_groups.new(name=skinned);vg.add(list(range(len(obj.data.vertices))),1,"REPLACE")
        mod=obj.modifiers.new("Bind_to_53_Bone_Rig","ARMATURE");mod.object=rig
    obj["MARK_node_id"]=n.replace(" ","_")
    objs.append(obj)
    return obj
def tube(n,coords,r,material,bone=None,steps=8):
    ps=[Vector(p) for p in coords]
    vs=[];fs=[]
    for i,p in enumerate(ps):
        d=(ps[min(i+1,len(ps)-1)]-ps[max(0,i-1)]).normalized()
        u=d.cross(Vector((0,0,1)) if abs(d.z)<.9 else Vector((0,1,0))).normalized()
        v=d.cross(u).normalized()
        for k in range(steps):
            q=p+r*(u*cos(2*pi*k/steps)+v*sin(2*pi*k/steps))
            vs.append(tuple(q))
    for i in range(len(ps)-1):
        for j in range(steps):
            a=i*steps+j;b=i*steps+(j+1)%steps
            fs.append((a,b,b+steps,a+steps))
    fs.append(tuple(reversed(range(steps))))
    fs.append(tuple((len(ps)-1)*steps+j for j in range(steps)))
    return fresh(n,vs,fs,material,bone)
def ellipsoid(n,c,rad,material,bone=None,steps=24,rings=12):
    vs=[];fs=[]
    for j in range(rings+1):
        t=pi*j/rings
        for k in range(steps):
            a=2*pi*k/steps
            vs.append((c[0]+rad[0]*sin(t)*cos(a),c[1]+rad[1]*sin(t)*sin(a),c[2]+rad[2]*cos(t)))
    for j in range(rings):
        for k in range(steps):
            a=j*steps+k;b=j*steps+(k+1)%steps
            fs.append((a,b,b+steps,a+steps))
    return fresh(n,vs,fs,material,bone)
def loft(n,rings,material,bone=None,steps=40):
    # rings are xcenter, ycenter, z, xr, yr; details have true 3D surface.
    vs=[];fs=[]
    for xc,yc,z,rx,ry in rings:
        for k in range(steps):
            t=2*pi*k/steps
            vs.append((xc+rx*cos(t),yc+ry*sin(t),z))
    for i in range(len(rings)-1):
        for k in range(steps):
            a=i*steps+k;b=i*steps+(k+1)%steps
            fs.append((a,b,b+steps,a+steps))
    fs.append(tuple(reversed(range(steps))))
    fs.append(tuple((len(rings)-1)*steps+k for k in range(steps)))
    return fresh(n,vs,fs,material,bone)
def patch(n,p,material,bone=None):
    return fresh(n,p,[(0,1,2),(0,2,3)],material,bone)
def cloth_duplicate(name,pred,material,inflate=.012,relax=.0):
    obj=body.copy();obj.data=body.data.copy();bpy.context.collection.objects.link(obj)
    obj.name=name
    bm=bmesh.new();bm.from_mesh(obj.data);bm.faces.ensure_lookup_table()
    doomed=[f for f in bm.faces if not pred(f.calc_center_median())]
    bmesh.ops.delete(bm,geom=doomed,context="FACES")
    # never deform full body topology beyond selective exposed garment area.
    bm.to_mesh(obj.data);bm.free()
    obj.data.update()
    if len(obj.data.vertices)==0:
        raise RuntimeError("Empty organic garment "+name)
    for v in obj.data.vertices:
        v.co+=v.normal*inflate
        if relax:
            v.co.x*=1+relax
            # Draping with subtle folds, not dangling ring primitives.
            if 0.10<v.co.z<1.15:
                wav=sin(v.co.z*46+v.co.x*17)*.0034
                v.co+=v.normal*wav
    obj.data.materials.clear();obj.data.materials.append(mat[material])
    for p in obj.data.polygons:p.use_smooth=True;p.material_index=0
    if relax:
        # A subtle solid garment layer; preserves real weight-painted deformation.
        sol=obj.modifiers.new("Cloth_weight","SOLIDIFY");sol.thickness=.004
    obj["MARK_node_id"]=name
    obj["authoring_surface"]="Extracted from weighted organic human topology"
    objs.append(obj)
    return obj
# modest child proportions: fuller skull and narrower jaw; does not break rig weights.
# Body already has anatomical childlike UV and real pre-textured face (not generated spheres).
verts=body.data.vertices
for v in verts:
    z=v.co.z
    if z>=1.42:
        k=min(1,(z-1.42)/.12)
        # Preserve face UV features while making cranium more youthful.
        v.co.x*=1+.115*k
        v.co.y*=1+.095*k
        v.co.z=1.42+(z-1.42)*(1+.065*k)
    elif 1.23<z<1.39:
        k=max(0,min(1,(z-1.23)/.16))
        v.co.x*=1-.055*k
body.data.update()
# Surface sculpt hoodie and jeans from skinned mesh's original anatomy.
hoodie=cloth_duplicate("Hoodie_Organic_Skinned",
    lambda c: .815<c.z<1.328 and (abs(c.x)<.37 or (c.z>1.11 and abs(c.x)<.42)) and
    not (abs(c.x)>.39 and c.z<1.10),
    "hoodie",inflate=.019,relax=.045)
pants=cloth_duplicate("Cargo_Organic_Skinned",
    lambda c: .12<c.z<.884 and abs(c.x)<.34,
    "pants",inflate=.016,relax=.1)
sleeves=cloth_duplicate("Hoodie_Sleeves_WeightPainted",
    lambda c: .94<c.z<1.325 and abs(c.x)>.20 and abs(c.x)<.53
    and not(abs(c.x)>.43 and c.z<1.095),
    "hoodie",inflate=.017,relax=.045)
# physically sewn hood from contoured elliptical textile rings, wraps back of head
hood=loft("Hood_Contoured_Cloth",[
 (0,.075,1.225,.19,.135),(0,.090,1.275,.211,.15),
 (0,.105,1.335,.203,.14),(0,.101,1.38,.155,.14),
 (0,.095,1.406,.12,.11),
 (0,.077,1.423,.065,.07)],"hoodie",bone="spine_03",steps=42)
# Remove front portion of hood: hood is a rear shell, not a spherical helmet.
bm=bmesh.new();bm.from_mesh(hood.data)
bmesh.ops.delete(bm,geom=[f for f in bm.faces if f.calc_center_median().y<-.02],context="FACES")
bm.to_mesh(hood.data);bm.free()
tube("Hood_Stitched_Center",[(0,.228,1.248),(0,.239,1.31),(0,.235,1.36),(0,.175,1.406)],.0045,"seam","spine_03")
# Ribbed collar and hem using cloth bands closely following torso rather than visible rings.
loft("Hoodie_Ribbed_Hem",[
 (0,0,.805,.186,.104),(0,0,.819,.198,.112),(0,0,.849,.201,.112)],"hoodie_trim","pelvis",32)
for side in (-1,1):
    sx=side*.16
    tube("Hood_Drawcord_"+str(side),[(sx*.45,-.143,1.31),(sx*.45,-.15,1.205),(sx*.46,-.153,1.17)],
       .0042,"white","spine_03")
# Fabric kangaroo pouch laid against front, not a rigid bulky box.
patch("Kangaroo_Pouch_Cloth",[(-.152,-.146,.88),(.152,-.146,.88),(.168,-.158,1.01),(-.168,-.158,1.01)],
      "hoodie","spine_01")
tube("Pouch_Top_Stitch",[(-.165,-.161,1.007),(0,-.163,1.004),(.165,-.161,1.007)],.0027,"seam","spine_01")
for side in (-1,1):
    tube("Pouch_Diagonal_"+str(side),
         [(side*.15,-.16,.99),(side*.11,-.164,.93),(side*.08,-.16,.89)],.003,"seam","spine_01")
# physically attached rhythm waveform on hoodie chest, where all segments move with torso.
wave=[(-.165,1.115),(-.146,1.116),(-.135,1.13),(-.123,1.10),
      (-.111,1.145),(-.099,1.112),(-.087,1.119),(-.075,1.10),
      (-.063,1.139),(-.051,1.106),(-.038,1.119),(-.026,1.15),
      (-.012,1.094),(0,1.123),(.014,1.141),(.025,1.09),
      (.036,1.129),(.049,1.107),(.061,1.149),(.074,1.104),
      (.085,1.14),(.10,1.119),(.112,1.13),(.125,1.103),
      (.138,1.133),(.15,1.117),(.168,1.117)]
for i in range(len(wave)-1):
    a,b=wave[i:i+2]
    tube("Hoodie_Equalizer_%02d"%i,
         [(a[0],-.152,a[1]),(b[0],-.152,b[1])],.0024,
         "lightcyan" if a[0]<.015 else "lightpink","spine_03",6)
# Cargo pocket flaps sewn directly to the outer pant shape, with border.
for side in (-1,1):
    x=side*.228
    patch("Cargo_Outer_Pocket_"+str(side),[
       (x,-.045,.58),(x,-.065,.60),(x,-.063,.77),(x,-.048,.765)
    ] if side>0 else [
       (x,-.04,.58),(x,-.066,.59),(x,-.067,.76),(x,-.045,.767)
    ],"pants2","thigh_r" if side>0 else "thigh_l")
    tube("Cargo_Flap_Seam_"+str(side),
         [(x,-.072,.751),(x,-.08,.718),(x,-.072,.71)],.004,"jean_seam",
         "thigh_r" if side>0 else "thigh_l")
    # actual cloth creases following tapered anatomical trouser
    for j,z in enumerate((.25,.33,.55,.76)):
        tube("Pant_Crease_%d_%d"%(side,j),[
          (side*.10,-.10,z),(side*.14,-.113,z-.005),(side*.184,-.092,z+.013)
        ],.0025,"jean_seam","calf_r" if z<.5 and side>0 else
        "calf_l" if z<.5 else "thigh_r" if side>0 else "thigh_l",6)
# ---------- properly tailored baseball cap mesh ----------
loft("Cap_Tailored_Crown",[
 (0,.019,1.617,.135,.107),
 (0,.021,1.66,.145,.114),
 (0,.025,1.70,.124,.103),
 (0,.024,1.737,.091,.087),
 (0,.023,1.764,.042,.046),
 (0,.023,1.769,.007,.01)],"cap","head",steps=48)
for side in (-1,1):
    tube("Cap_Panel_Stitch_"+str(side),[
       (side*.06,-.081,1.653),(side*.065,-.08,1.71),
       (side*.04,-.045,1.754)],.0022,"cap_dark","head",6)
# Curved brim is real shell with thickness and radial UV-ready topology.
vs=[];fs=[];N=32
for y,rx,z in [(-.060,.143,1.627),(-.155,.151,1.61),(-.27,.125,1.596)]:
    for i in range(N):
        x=(2*i/(N-1)-1)*rx
        vs.append((x,y+.017*(x/rx)**2,z+.012*(x/rx)**2))
for j in range(2):
    for i in range(N-1):
        a=j*N+i;fs.append((a,a+1,a+N+1,a+N))
brim=fresh("Cap_Curved_Visor",vs,fs,"cap","head")
sol=brim.modifiers.new("Fabric_Brim","SOLIDIFY");sol.thickness=.008
tube("Cap_Visor_Binding",[
    (x,-.27+.017*(x/.125)**2,1.596+.012*(x/.125)**2)
    for x in [-.125,-.095,-.055,0,.055,.095,.125]],
    .004,"cap_dark","head")
# Physical embroidered M on the front panel.
for j,(a,b) in enumerate([
 ((-.057,1.679),(-.057,1.721)),
 ((-.057,1.721),(0,1.688)),
 ((0,1.688),(.057,1.721)),
 ((.057,1.721),(.057,1.679))]):
    tube("Cap_Logo_M_%d"%j,[(a[0],-.094,a[1]),(b[0],-.094,b[1])],.0048,"white","head",6)
# Hair: original image texture depicts natural hair. Only a textured nape cap is added
# and kept beneath the cap brim: not a bead-made wig.
# ---------- Headphones with actual ring loops & independent PBR ----------
for side in (-1,1):
    x=side*.155
    # two thick non-planar domed surfaces, mechanically connected.
    ellipsoid("Earcup_Housing_"+str(side),(x,0,1.54),(.032,.074,.093),"cup","head",28,14)
    ellipsoid("Earcup_Padded_Cushion_"+str(side),
        (side*.132,.01,1.535),(.022,.070,.084),"earpad","head",28,14)
    ellipsoid("Earcup_Exterior_Disc_"+str(side),
        (side*.182,0,1.54),(.011,.066,.080),"steel","head",28,14)
    for r,c in ((.074,"pink"),(.060,"cyan")):
        pts=[(side*.192,r*cos(2*pi*i/56),1.54+r*sin(2*pi*i/56))
            for i in range(57)]
        tube("RGB_Headphone_Ring_%s_%s"%(side,c),pts,.0045,c,"head",10)
    x=side*.203
    for i,(a,b) in enumerate([((-.027,1.519),(-.027,1.560)),
                             ((-.027,1.56),(0,1.535)),
                             ((0,1.535),(.027,1.56)),
                             ((.027,1.56),(.027,1.519))]):
        tube("Headphone_M_%s_%s"%(side,i),[(x,*a),(x,*b)],.004,"cyan","head",6)
    tube("Headset_Hinge_"+str(side),[
        (side*.16,.0,1.63),(side*.165,.012,1.675),
        (side*.13,.013,1.731)],.012,"steel","head",10)
# Curved arc running over crown.
pts=[(.157*cos(pi*i/42),.02,1.538+.251*sin(pi*i/42)) for i in range(43)]
tube("Headphone_Topband",pts,.016,"cup","head",10)
tube("Topband_Cyan_Accent",[(x,y-.010,z+.006) for x,y,z in pts],.003,"cyan","head",8)
# ---------- organic shoes built over skinned feet ----------
for side in (-1,1):
    cx=side*.163;bn="foot_r" if side>0 else "foot_l"
    # shoe sole shell sweeps towards toe (-Y) with true 3D geometry.
    rings=[
       (cx,.133,.050,.071),
       (cx,.085,.057,.083),
       (cx,-.021,.062,.090),
       (cx,-.132,.064,.080),
       (cx,-.215,.060,.049)]
    vs=[];fs=[];N=30
    for cxr,y,z,rx in rings:
        for i in range(N):
            t=2*pi*i/N
            vs.append((cxr+rx*cos(t),y,z+.029*sin(t)))
    for j in range(len(rings)-1):
        for i in range(N):
            a=j*N+i;b=j*N+(i+1)%N
            fs.append((a,b,b+N,a+N))
    solesh=fresh("Sneaker_Sculpted_Outsole_"+str(side),vs,fs,"sole",bn)
    # Toe cap hugs front foot; laces are physical strings, not on-screen decals.
    ellipsoid("Sneaker_ToeCap_"+str(side),(cx,-.146,.104),(.078,.096,.039),"white",bn,24,12)
    for j in range(4):
        y=-.11+j*.038
        tube("Shoe_Laces_%d_%d"%(side,j),[
            (cx-.041,y,.151),(cx,y-.008,.158),(cx+.041,y,.151)
        ],.004,"white",bn,6)
    # Real rubber sidewall strip and sneaker's cyan accent.
    tube("Sneaker_Cyan_Stripe_"+str(side),[
       (cx+side*.075,-.18,.089),(cx+side*.086,-.08,.092),
       (cx+side*.08,.064,.092)],.006,"cyan",bn,8)
    tube("Sneaker_Pink_Heel_"+str(side),[
       (cx-.054,.12,.094),(cx,.14,.096),(cx+.054,.12,.094)],.006,"pink",bn)
# ---------- dance with real deformation of 53-bone MakeHuman mesh ----------
for pb in rig.pose.bones:pb.rotation_mode="XYZ";pb.rotation_euler=(0,0,0)
ad=rig.animation_data_create();ad.action=bpy.data.actions.new("NEON_BOY_6_SECOND_DANCE")
seq=list(range(1,181,9))+[181]
for frame in seq:
    q=2*pi*(frame-1)/180
    def pose(bn,rx=0,ry=0,rz=0):
        b=rig.pose.bones.get(bn)
        if b:
            b.rotation_euler=(rx,ry,rz)
            b.keyframe_insert(data_path="rotation_euler",frame=frame,group=bn)
    pose("pelvis",.065*sin(q*2),.054*sin(q),.082*sin(q))
    pose("spine_01",.04*sin(q*2+.5),.03*sin(q),.04*sin(q))
    pose("spine_02",.05*sin(q*2+1),.035*sin(q+1),.05*sin(q+1))
    pose("spine_03",.06*sin(q*2),.08*sin(q+.6),.055*sin(q+pi/2))
    pose("neck_01",.027*sin(q*2),.027*sin(q),.045*sin(q))
    pose("head",.065*sin(q*2+1),.025*sin(q),.07*sin(q))
    for sign,side in ((-1,"l"),(1,"r")):
        a=q+(pi if sign>0 else 0)
        pose("clavicle_"+side,.06*sin(a),.08*sin(a+pi/2),.10*sin(a))
        pose("upperarm_"+side,.28*sin(a)+.13,.12*sin(a+pi/2),sign*(.25+.28*sin(a+.7)))
        pose("lowerarm_"+side,-.21-.29*(.5+.5*sin(a+.8)),.06*sin(a),.10*sin(a))
        pose("hand_"+side,.09*sin(a+.8),.06*sin(a),.06*sin(a))
        pose("thigh_"+side,.18*sin(a),.06*sin(a),.04*sin(a+1))
        pose("calf_"+side,-.11-.20*(.5+.5*sin(a+pi/2)),.02*sin(a),0)
        pose("foot_"+side,.12*sin(a+.2),0,0)
        for finger in ("index","middle","ring","pinky"):
            for seg in ("01","02","03"):
                pose(finger+"_"+seg+"_"+side,0,0,(-.12 if seg=="01" else -.28))
    rig.location=(.027*sin(q),0,.014*(1-cos(q*4)))
    rig.keyframe_insert(data_path="location",frame=frame,group="RootMotion")
bpy.context.scene.frame_start=1;bpy.context.scene.frame_end=181
bpy.context.scene.render.fps=30
bpy.context.scene.frame_set(1)
# ---------- studio lighting / export (selection = character only) ----------
world=bpy.context.scene.world or bpy.data.worlds.new("Studio_Env")
bpy.context.scene.world=world;world.use_nodes=True
world.node_tree.nodes["Background"].inputs["Color"].default_value=(.13,.14,.20,1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value=.55
def area(n,loc,power,color,size):
    dat=bpy.data.lights.new(n,'AREA');dat.energy=power;dat.color=color;dat.shape='DISK';dat.size=size
    o=bpy.data.objects.new(n,dat);bpy.context.collection.objects.link(o)
    o.location=loc;o.rotation_euler=(Vector((0,0,.9))-o.location).to_track_quat('-Z','Y').to_euler()
area("Key_warm",(-2.1,-2.4,3.3),650,(1,.86,.77),3)
area("Fill_cyan",(2.4,-1.3,2.4),280,(.25,.72,1),2.5)
area("Rim_magenta",(1.1,2.1,2.5),410,(1,.24,.68),2.1)
floorMat=pbr("Studio_floor","#242633",metal=.18,rough=.7)
floor=fresh("RENDER_ONLY_FLOOR",[(-40,-40,-.06),(40,-40,-.06),(40,40,-.06),(-40,40,-.06)],[(0,1,2),(0,2,3)],floorMat)
objs.remove(floor)
def camera(n,loc,target=(0,0,.87)):
    dat=bpy.data.cameras.new(n);dat.type='ORTHO';dat.ortho_scale=2.0
    o=bpy.data.objects.new(n,dat);bpy.context.collection.objects.link(o)
    o.location=loc;o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
    bpy.context.scene.camera=o
    return o
bpy.context.scene.render.engine='CYCLES';bpy.context.scene.cycles.samples=28
bpy.context.scene.render.resolution_x=620;bpy.context.scene.render.resolution_y=760
bpy.context.scene.render.resolution_percentage=100
bpy.context.scene.render.image_settings.file_format='PNG'
bpy.context.scene.view_settings.view_transform='AgX'
bpy.context.scene.view_settings.look='AgX - Medium High Contrast'
bpy.ops.wm.save_as_mainfile(filepath=str(O.joinpath("NEON_BOY_V4_ORGANIC.blend").absolute()))
# Export a full rigged human (with solid skinned clothes).
bpy.ops.object.select_all(action="DESELECT")
for o in [body,rig]+objs:o.select_set(True)
bpy.context.view_layer.objects.active=rig
bpy.ops.export_scene.gltf(filepath=str(O.joinpath("NEON_BOY_V4_DANCE.glb").absolute()),
    export_format='GLB',use_selection=True,export_skins=True,export_animations=True)
bpy.ops.export_scene.gltf(filepath=str(O.joinpath("NEON_BOY_V4_STATIC.glb").absolute()),
    export_format='GLB',use_selection=True,export_skins=False,export_animations=False)
for label,loc,fr in [("front",(0,-3.8,1.45),1),
 ("side",(3.8,0,1.45),1),("back",(0,3.8,1.45),1),
 ("dance",(2.6,-3.2,1.8),42)]:
    bpy.context.scene.frame_set(fr);camera("CAM_"+label,loc)
    bpy.context.scene.render.filepath=str(O.joinpath("render_"+label+".png").absolute())
    bpy.ops.render.render(write_still=True)
def glb_stats(path):
    raw=path.read_bytes()
    assert raw[:4]==b'glTF' and struct.unpack_from('<I',raw,8)[0]==len(raw)
    js_len=struct.unpack_from('<I',raw,12)[0]
    j=json.loads(raw[20:20+js_len])
    return {"file":path.name,"bytes":len(raw),
        "mesh_count":len(j.get("meshes",[])),
        "skins":len(j.get("skins",[])),
        "joints":sum(len(x["joints"]) for x in j.get("skins",[])),
        "clips":len(j.get("animations",[])),
        "materials":len(j.get("materials",[]))}
stats={"animated":glb_stats(O/"NEON_BOY_V4_DANCE.glb"),
       "static":glb_stats(O/"NEON_BOY_V4_STATIC.glb"),
       "render_names":sorted(x.name for x in O.glob('render_*.png')),
       "human_mesh_vertices":len(body.data.vertices),
       "garment_objects":len(objs),
       "source":"CC0 MakeHuman rigged human via vsim source glb",
       "limitations":"Artistic likeness is approximate; NOT tested inside MARK 3D Studio"}
assert stats["animated"]["skins"]>=1 and stats["animated"]["clips"]>=1,stats
assert len(stats["render_names"])==4,stats
(O/"validation.json").write_text(json.dumps(stats,indent=2),encoding='utf-8')
print("V4_ORGANIC_EXPORT_SUCCESS",json.dumps(stats),flush=True)
