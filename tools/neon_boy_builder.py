"""MARK Neon Boy — Blender 4.x procedural character and skeletal dance.
Run: blender -b -t 2 --python tools/neon_boy_builder.py
Outputs in ./output. No paid APIs or third-party assets.
"""
import bpy, math, os, json, struct
from mathutils import Vector
from math import sin, cos, pi

OUT = os.path.abspath("output")
os.makedirs(OUT, exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
for obj in list(bpy.data.materials):
    bpy.data.materials.remove(obj)

def mat(name, hexcolor, metal=0, rough=.6, emission=None, emission_strength=0):
    rgb=tuple(int(hexcolor[i:i+2],16)/255 for i in (1,3,5))
    m=bpy.data.materials.new(name)
    m.diffuse_color=(*rgb,1)
    m.use_nodes=True
    bs=m.node_tree.nodes.get("Principled BSDF")
    bs.inputs["Base Color"].default_value=(*rgb,1)
    bs.inputs["Metallic"].default_value=metal
    bs.inputs["Roughness"].default_value=rough
    if emission:
        ec=tuple(int(emission[i:i+2],16)/255 for i in (1,3,5))
        bs.inputs["Emission Color"].default_value=(*ec,1)
        bs.inputs["Emission Strength"].default_value=emission_strength
    return m

M={}
for name,c,metal,rough in [
    ("skin","#F3B291",0,.59),("skin_shade","#D98871",0,.65),
    ("cheek","#E99389",0,.8),("hair","#302021",0,.84),
    ("eye_white","#FFF9F0",0,.2),("eye_dark","#1D1920",.05,.14),
    ("hoodie","#16192F",0,.86),("hoodie_top","#222441",0,.82),
    ("hoodie_seam","#333753",0,.86),("hoodie_black","#0D1020",0,.82),
    ("cargo","#51515E",0,.88),("cargo_light","#656472",0,.83),
    ("cargo_dark","#343640",0,.88),("shoe_white","#DEE1E8",0,.48),
    ("shoe_navy","#25283E",0,.49),("shoe_grey","#858995",0,.56),
    ("shoe_rubber","#11192A",0,.65),("cap_red","#D81343",0,.67),
    ("cap_shadow","#951031",0,.73),("neon_blue","#00CFFF",.16,.28),
    ("neon_pink","#FF38D4",.13,.27),("headphone","#17182D",.25,.38),
    ("headphone_purple","#553D89",.32,.28),("cyan_print","#51E6FF",0,.5),
    ("pink_print","#FE67D7",0,.5),("white","#F9F8FF",0,.5)
]:
    M[name]=mat(name,c,metal,rough,emission=c if name in ("neon_blue","neon_pink","cyan_print","pink_print") else None, emission_strength=1.7 if name.startswith("neon") else .45)

def assign(obj, material):
    obj.data.materials.append(M[material] if isinstance(material,str) else material)
    if obj.type=="MESH":
        for p in obj.data.polygons:
            p.use_smooth=True
    return obj

def cube(name,loc,dims, material, bevel=.045):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o=bpy.context.object
    o.name=name
    o.dimensions=dims
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        mod=o.modifiers.new("soft_edges","BEVEL"); mod.width=bevel; mod.segments=3
        bpy.context.view_layer.objects.active=o
        bpy.ops.object.modifier_apply(modifier=mod.name)
        n=o.modifiers.new("weighted_normals","WEIGHTED_NORMAL")
        bpy.ops.object.modifier_apply(modifier=n.name)
    return assign(o,material)

def ball(name,loc,scale,material,segments=24,rings=16):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings,location=loc)
    o=bpy.context.object
    o.name=name
    o.scale=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return assign(o,material)

def cylinder(name,loc, radius, depth,material,rotation=(0,0,0),vertices=32):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=depth,location=loc,rotation=rotation)
    o=bpy.context.object;o.name=name
    bev=o.modifiers.new("rim_round","BEVEL");bev.width=min(depth*.23,radius*.2);bev.segments=3
    bpy.ops.object.modifier_apply(modifier=bev.name)
    return assign(o,material)

def mesh_create(name,vertices,faces,material):
    m=bpy.data.meshes.new(name+"-geom")
    m.from_pydata(vertices,[],faces);m.update()
    obj=bpy.data.objects.new(name,m)
    bpy.context.collection.objects.link(obj)
    return assign(obj,material)

def ring_loft(name,rings,material,steps=24):
    # rings: (z, cx, cy, rx, ry)
    vs=[];fs=[]
    for z,cx,cy,rx,ry in rings:
        for k in range(steps):
            a=2*pi*k/steps
            vs.append((cx+rx*cos(a),cy+ry*sin(a),z))
    for r in range(len(rings)-1):
        for k in range(steps):
            a=r*steps+k;b=r*steps+(k+1)%steps
            fs.append((a,b,b+steps,a+steps))
    fs.append(tuple(range(steps-1,-1,-1)))
    fs.append(tuple((len(rings)-1)*steps+k for k in range(steps)))
    return mesh_create(name,vs,fs,material),steps

def shoe_loft(name,rings,material,steps=24):
    # rings: (y,cx,cz,rx,rz)
    vs=[];fs=[]
    for y,cx,cz,rx,rz in rings:
        for k in range(steps):
            a=2*pi*k/steps
            vs.append((cx+rx*cos(a),y,cz+rz*sin(a)))
    for r in range(len(rings)-1):
        for k in range(steps):
            a=r*steps+k;b=r*steps+(k+1)%steps
            fs.append((a,b,b+steps,a+steps))
    fs.append(tuple(range(steps-1,-1,-1)))
    fs.append(tuple((len(rings)-1)*steps+k for k in range(steps)))
    return mesh_create(name,vs,fs,material)

def tube(name,points,radius,material,sides=8):
    vs=[];fs=[]
    ps=[Vector(p) for p in points]
    for i,c in enumerate(ps):
        d=(ps[min(i+1,len(ps)-1)]-ps[max(0,i-1)]).normalized()
        ref=Vector((0,1,0)) if abs(d.y)<.9 else Vector((1,0,0))
        u=d.cross(ref).normalized();v=d.cross(u).normalized()
        for j in range(sides):
            q=c+radius*(u*cos(2*pi*j/sides)+v*sin(2*pi*j/sides))
            vs.append(tuple(q))
    for i in range(len(ps)-1):
        for j in range(sides):
            a=i*sides+j;b=i*sides+(j+1)%sides
            fs.append((a,b,b+sides,a+sides))
    fs.append(tuple(range(sides-1,-1,-1)))
    fs.append(tuple((len(ps)-1)*sides+j for j in range(sides)))
    return mesh_create(name,vs,fs,material)

def line(name,a,b,r,material):
    return tube(name,[a,b],r,material)

def face_text(name,text,loc,size,material,rotation=(pi/2,0,0)):
    cr=bpy.data.curves.new(name,'FONT')
    cr.body=text;cr.align_x="CENTER";cr.align_y="CENTER";cr.size=size;cr.extrude=.005
    ob=bpy.data.objects.new(name,cr);bpy.context.collection.objects.link(ob)
    ob.location=loc;ob.rotation_euler=rotation
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True);bpy.context.view_layer.objects.active=ob
    bpy.ops.object.convert(target="MESH")
    return assign(bpy.context.object,material)

# Skeleton: rest-space positions, glTF-compatible humanoid joints.
arm_data=bpy.data.armatures.new("NeonBoyRig")
rig=bpy.data.objects.new("NeonBoy_Armature",arm_data)
bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active=rig
rig.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
def bone(name,head,tail,parent=None):
    b=arm_data.edit_bones.new(name)
    b.head=head;b.tail=tail
    if parent: b.parent=arm_data.edit_bones[parent]
    return b
bone("Hips",(0,0,2.12),(0,0,2.44))
bone("Spine",(0,0,2.44),(0,0,3.28),"Hips")
bone("Chest",(0,0,3.28),(0,0,3.74),"Spine")
bone("Neck",(0,0,3.74),(0,0,4.08),"Chest")
bone("Head",(0,0,4.08),(0,0,4.75),"Neck")
for s,letter in ((-1,"L"),(1,"R")):
    bone("UpperArm."+letter,(s*.69,0,3.7),(s*1.07,0,3.04),"Chest")
    bone("Forearm."+letter,(s*1.07,0,3.04),(s*1.21,-.09,2.48),"UpperArm."+letter)
    bone("Hand."+letter,(s*1.21,-.09,2.48),(s*1.25,-.12,2.21),"Forearm."+letter)
    bone("Thigh."+letter,(s*.45,0,2.22),(s*.51,-.02,1.35),"Hips")
    bone("Shin."+letter,(s*.51,-.02,1.35),(s*.53,0,.54),"Thigh."+letter)
    bone("Foot."+letter,(s*.53,0,.54),(s*.53,-.38,.24),"Shin."+letter)
bpy.ops.object.mode_set(mode="OBJECT")
rig.show_in_front=False
objects=[]
def skin(obj,bone_name):
    vg=obj.vertex_groups.new(name=bone_name)
    vg.add(list(range(len(obj.data.vertices))),1,"REPLACE")
    mod=obj.modifiers.new("CharacterSkeleton","ARMATURE")
    mod.object=rig
    objects.append(obj)
    return obj

def skin_rings(obj,steps,ringbones):
    n=len(obj.data.vertices)//steps
    assert n==len(ringbones),(obj.name,n,len(ringbones))
    for i,wd in enumerate(ringbones):
        for k,w in wd.items():
            if w>.0001:
                obj.vertex_groups.get(k) or obj.vertex_groups.new(name=k)
                obj.vertex_groups[k].add(list(range(i*steps,(i+1)*steps)),w,"REPLACE")
    mod=obj.modifiers.new("CharacterSkeleton","ARMATURE");mod.object=rig
    objects.append(obj)
    return obj

# Pants, stitched cargo pockets and sneakers
for s,letter in ((-1,"L"),(1,"R")):
    cx=s*.48
    leg_rings=[
        (2.42,cx, .035,.35,.35),(2.26,cx,.04,.38,.35),
        (2.04,cx,.025,.385,.36),(1.8,cx,.05,.37,.34),
        (1.58,cx,.05,.405,.355),(1.4,cx,.04,.37,.34),
        (1.28,cx,.055,.365,.36),(1.04,cx,.03,.39,.37),
        (.85,cx,.025,.36,.34),(.70,cx,.015,.32,.31),
        (.59,cx,.005,.245,.26),(.54,cx,.005,.22,.24)]
    p,steps=ring_loft("CargoPants_"+letter,leg_rings,"cargo",28)
    influences=[]
    for z,*_ in leg_rings:
        w=max(0,min(1,(z-1.18)/.42))
        influences.append({"Thigh."+letter:w,"Shin."+letter:1-w})
    skin_rings(p,steps,influences)
    for i,(z,rx) in enumerate(((2.10,.37),(1.61,.385),(.92,.36))):
        o=tube("FabricFold_"+letter+str(i),[(cx+rx*cos(t),.045+.30*sin(t),z+.02*sin(3*t)) for t in [j*2*pi/28 for j in range(29)]],.012,"cargo_light")
        skin(o,"Thigh."+letter if z>1.28 else "Shin."+letter)
    # cargo pocket on outer side of each leg
    pocket=cube("CargoPocket_"+letter,(cx+s*.375,-.035,1.54),(.115,.52,.48),"cargo_light",.045)
    skin(pocket,"Thigh."+letter)
    flap=cube("CargoPocketFlap_"+letter,(cx+s*.444,-.038,1.76),(.035,.54,.13),"cargo_dark",.018)
    skin(flap,"Thigh."+letter)
    seam=line("PocketSeam_"+letter,(cx+s*.449,-.26,1.69),(cx+s*.449,.19,1.69),.01,"shoe_grey")
    skin(seam,"Thigh."+letter)
    cuff,st=ring_loft("AnkleRib_"+letter,[(.55,cx,0,.22,.23),(.62,cx,0,.23,.235),(.65,cx,0,.24,.24)],"hoodie_black",24)
    skin(cuff,"Shin."+letter)

    # Sneakers: elongated toe facing Y-negative
    sole=shoe_loft("Sneaker_Sole_"+letter,[
        (-.73,cx,.13,.13,.08),(-.66,cx,.13,.27,.12),(-.4,cx,.13,.32,.14),
        (-.06,cx,.13,.29,.16),(.26,cx,.15,.29,.17),(.39,cx,.16,.18,.12)],"shoe_white")
    skin(sole,"Foot."+letter)
    rubber=shoe_loft("Sneaker_Rubber_"+letter,[
        (-.74,cx,.075,.12,.03),(-.64,cx,.08,.275,.065),(-.32,cx,.08,.32,.065),
        (.15,cx,.08,.28,.07),(.37,cx,.09,.18,.055)],"shoe_rubber")
    skin(rubber,"Foot."+letter)
    upper=shoe_loft("Sneaker_Upper_"+letter,[
        (-.64,cx,.24,.12,.085),(-.53,cx,.27,.24,.13),(-.22,cx,.31,.27,.16),
        (.12,cx,.33,.255,.24),(.34,cx,.34,.19,.22)],"shoe_navy")
    skin(upper,"Foot."+letter)
    toe=shoe_loft("ToeCap_"+letter,[
        (-.68,cx,.25,.09,.06),(-.57,cx,.26,.21,.095),(-.43,cx,.25,.235,.1)],"shoe_white")
    skin(toe,"Foot."+letter)
    tongue=cube("ShoeTongue_"+letter,(cx,-.04,.47),(.24,.28,.10),"shoe_grey",.035)
    skin(tongue,"Foot."+letter)
    for j in range(4):
        y=-.33+j*.11
        lace=line("Shoelace_"+letter+str(j),(cx-.16,y,.455),(cx+.16,y,.455),.018,"white")
        skin(lace,"Foot."+letter)
    stripe=line("NeonShoeSide_"+letter,(cx+s*.27,-.45,.22),(cx+s*.29,.22,.25),.032,"neon_blue")
    skin(stripe,"Foot."+letter)
    stripe2=line("PinkShoeHeel_"+letter,(cx-s*.19,.3,.22),(cx+s*.18,.3,.22),.024,"neon_pink")
    skin(stripe2,"Foot."+letter)
    skin(face_text("SneakerM_"+letter,"M",(cx+s*.306,-.18,.32),.17,"neon_blue",rotation=(pi/2,0,s*pi/2)),"Foot."+letter)

# Hoodie body is shaped with 3D ring topology; different deformation weights.
torso_rings=[
    (2.36,0,.04,.65,.37),(2.45,0,.02,.78,.44),
    (2.62,0,0,.80,.44),(2.89,0,0,.76,.42),
    (3.18,0,.025,.70,.40),(3.44,0,.045,.77,.41),
    (3.67,0,.055,.76,.41),(3.84,0,.06,.60,.37),
    (3.94,0,.07,.40,.28)]
body,steps=ring_loft("Tailored_Hoodie_Body",torso_rings,"hoodie",40)
bodyweights=[]
for z,*_ in torso_rings:
    if z<2.8: bodyweights.append({"Hips":max(0,(2.8-z)/.5),"Spine":1-max(0,(2.8-z)/.5)})
    elif z>3.44:
        v=min(1,(z-3.44)/.32);bodyweights.append({"Spine":1-v,"Chest":v})
    else:bodyweights.append({"Spine":1.})
skin_rings(body,steps,bodyweights)
hem,steps=ring_loft("Hoodie_Ribbed_Hem",[(2.39,0,.02,.70,.41),(2.45,0,.02,.785,.445),(2.59,0,.02,.79,.44)],"hoodie_black",36)
skin(hem,"Hips")
shirt,steps=ring_loft("White_Undershirt",[(2.30,0,.01,.62,.35),(2.40,0,.01,.65,.365)],"white",36)
skin(shirt,"Hips")
# Hoodie kangaroo pouch on front
pouch=cube("Kangaroo_Pocket",(0,-.435,2.78),(1.0,.105,.42),"hoodie_top",.09)
skin(pouch,"Spine")
for side in (-1,1):
    seam=line("PocketEdge_"+str(side),(side*.48,-.497,2.83),(side*.37,-.50,2.63),.012,"hoodie_seam")
    skin(seam,"Spine")
# Hood wrap and drawstrings
hood=ball("Hood_Loose_Back",(0,.26,3.85),(.68,.45,.38),"hoodie_top",32,20)
skin(hood,"Chest")
hoodhole=ball("Hood_Inset_Neck",(0,-.21,3.985),(.34,.17,.09),"hoodie_black")
skin(hoodhole,"Chest")
for x in (-.14,.14):
    skin(tube("Drawstring_"+str(x),[(x,-.39,3.88),(x,-.455,3.59),(x,-.48,3.32)],.014,"shoe_grey"),"Chest")
    skin(cylinder("DrawstringTip_"+str(x),(x,-.48,3.32),.028,.08,"shoe_grey"),"Chest")

# Sleeves with continuous tube-like geometry, weighted across elbow.
def sleeve_mesh(letter,s):
    pts=[
        (s*.66,0,3.70,.285),
        (s*.80,-.005,3.63,.34),
        (s*.90,-.01,3.46,.31),
        (s*1.015,-.015,3.22,.31),
        (s*1.08,-.015,3.02,.29),
        (s*1.10,-.042,2.82,.29),
        (s*1.15,-.060,2.64,.255),
        (s*1.205,-.075,2.52,.19)]
    vs=[]; fs=[];steps=24
    for i,p in enumerate(pts):
        x,y,z,r=p
        c=Vector((x,y,z))
        if i<len(pts)-1: d=Vector(pts[i+1][:3])-c
        else: d=c-Vector(pts[i-1][:3])
        d.normalize(); ux=Vector((0,1,0));axis=d.cross(ux).normalized();other=axis.cross(d).normalized()
        for k in range(steps):
            a=2*pi*k/steps
            q=c+r*(axis*cos(a)+other*sin(a))
            vs.append(tuple(q))
    for i in range(len(pts)-1):
        for k in range(steps):
            a=i*steps+k;b=i*steps+(k+1)%steps
            fs.append((a,b,b+steps,a+steps))
    fs.append(tuple(range(steps-1,-1,-1)))
    fs.append(tuple((len(pts)-1)*steps+k for k in range(steps)))
    ob=mesh_create("Hoodie_Sleeve_"+letter,vs,fs,"hoodie")
    weights=[]
    for _,_,z,_ in pts:
        w=max(0,min(1,(z-2.88)/.32))
        weights.append({"UpperArm."+letter:w,"Forearm."+letter:1-w})
    skin_rings(ob,steps,weights)
    # Side stripe colored cyan (upper) pink (lower) hugging outside sleeve.
    for j in range(2):
        selected=pts[1:5] if j==0 else pts[4:8]
        coords=[(x+s*.22,y-.225,z) for x,y,z,r in selected]
        st=tube("RGB_Sleeve_"+letter+str(j),coords,.04,"neon_blue" if j==0 else "neon_pink")
        skin(st,"UpperArm."+letter if j==0 else "Forearm."+letter)
    cuff=ball("Sleeve_Cuff_"+letter,(s*1.205,-.075,2.52),(.20,.21,.11),"hoodie_black")
    skin(cuff,"Forearm."+letter)
for s,letter in ((-1,"L"),(1,"R")):
    sleeve_mesh(letter,s)
    # hands skin mesh, fingers kept separated, attached to hand bone
    hand=ball("Palm_"+letter,(s*1.225,-.10,2.335),(.126,.089,.192),"skin")
    skin(hand,"Hand."+letter)
    for j in range(4):
        y=-.16+(j*.04)
        finger=line("Finger_"+letter+str(j),(s*(1.15+j*.05),y,2.265),(s*(1.16+j*.05),y-.018,2.11),.033,"skin")
        skin(finger,"Hand."+letter)
    thumb=line("Thumb_"+letter,(s*1.12,-.18,2.41),(s*1.04,-.23,2.26),.047,"skin")
    skin(thumb,"Hand."+letter)

# Collar and head
skin(cylinder("NeckSkin",(0,0,4.065),.175,.27,"skin"),"Neck")
head_rings=[
    (4.08,0,-.04,.16,.22),(4.17,0,-.045,.31,.295),
    (4.32,0,-.035,.405,.32),(4.52,0,-.005,.43,.345),
    (4.70,0,.015,.40,.335),(4.83,0,.025,.29,.275),
    (4.92,0,.035,.12,.12)]
face,steps=ring_loft("Head_Facial_Topology",head_rings,"skin",40)
skin(face,"Head")
# Visible physical facial features
for s,side in ((-1,"L"),(1,"R")):
    skin(ball("Ear_"+side,(s*.412,.02,4.45),(.115,.09,.19),"skin"),"Head")
    skin(ball("Cheek_"+side,(s*.26,-.303,4.30),(.14,.035,.073),"cheek"),"Head")
    skin(ball("EyeSclera_"+side,(s*.184,-.327,4.535),(.122,.06,.099),"eye_white"),"Head")
    skin(ball("Iris_"+side,(s*.165,-.383,4.537),(.063,.026,.069),"eye_dark"),"Head")
    skin(ball("EyeGlint_"+side,(s*.146,-.409,4.562),(.018,.012,.019),"white"),"Head")
    skin(tube("Eyebrow_"+side,[(s*.09,-.37,4.663),(s*.18,-.362,4.695),(s*.29,-.329,4.671)],.021,"hair"),"Head")
skin(ball("NoseTip",(0,-.389,4.384),(.095,.08,.10),"skin"),"Head")
skin(tube("SmileCurve",[(x,-.345-0.085*(1-(x/.24)**2),4.245+.035*(abs(x)/.24)) for x in [-.24,-.18,-.09,0,.09,.18,.24]],.015,"skin_shade"),"Head")
# hair tufts by cap edge
for i in range(7):
    x=-.31+i*.103
    z=4.824+.018*cos(i*1.2)
    skin(ball("Fringe_"+str(i),(x,-.277,z),(.095,.075,.065),"hair",16,10),"Head")
# cap dome
cap_rings=[
    (4.742,0,.01,.437,.355),
    (4.825,0,.02,.435,.365),
    (4.96,0,.02,.40,.346),
    (5.06,0,.02,.31,.29),
    (5.125,0,.02,.16,.16),
    (5.142,0,.02,.025,.03)]
cap,steps=ring_loft("BaseballCap_Crown",cap_rings,"cap_red",40)
skin(cap,"Head")
skin(tube("Cap_Seam",[(0,-.344,4.77),(0,-.34,4.90),(0,-.30,5.04),(0,-.13,5.13)],.008,"cap_shadow"),"Head")
# cap curved brim: dimensions, fan under the front center
brimverts=[];brimfaces=[]
steps=20
for row,(depth,width,z) in enumerate(((0,.425,4.775),(-.28,.425,4.744),(-.46,.33,4.716))):
    for j in range(steps):
        x=-1+2*j/(steps-1)
        brimverts.append((x*width,depth-.275+.03*x*x,z+.01*x*x))
for r in range(2):
    for j in range(steps-1):
        a=r*steps+j;brimfaces.append((a,a+1,a+steps+1,a+steps))
brim=mesh_create("Cap_Visor",brimverts,brimfaces,"cap_red")
solid=brim.modifiers.new("VisorThickness","SOLIDIFY");solid.thickness=.037
bpy.context.view_layer.objects.active=brim
bpy.ops.object.modifier_apply(modifier=solid.name)
skin(brim,"Head")
skin(face_text("Cap_Logo_M","M",(0,-.368,4.967),.245,"white"),"Head")
# Headphone over-ear cups with cyan-magenta LED rings
for s,side in ((-1,"L"),(1,"R")):
    rot=(0,pi/2,0)
    skin(cylinder("HeadphoneCup_"+side,(s*.525,0,4.54),.298,.19,"headphone",rot),"Head")
    skin(cylinder("HeadphoneFace_"+side,(s*.637,0,4.54),.258,.034,"headphone_purple",rot),"Head")
    for r,cl in ((.257,"neon_pink"),(.217,"neon_blue")):
        ring=[(s*.67,r*cos(2*pi*i/48),4.54+r*sin(2*pi*i/48)) for i in range(49)]
        skin(tube("RGB_Ring_"+side+"_"+str(r),ring,.017,cl),"Head")
    # Ear-cup M symbol built as 3D bars
    x=s*.695
    for a,b in [
        ((-.09,4.47),(-.09,4.61)),
        ((-.09,4.61),(0,4.535)),
        ((0,4.535),(.09,4.61)),
        ((.09,4.61),(.09,4.47))
    ]:
        skin(line("M_Headphone_"+side,(x,a[0],a[1]),(x,b[0],b[1]),.019,"neon_blue"),"Head")
# headband arc, goes above cap from ear to ear
band=[(-.53*cos(pi*i/32),0,4.535+.63*sin(pi*i/32)) for i in range(33)]
skin(tube("Headphone_Band",band,.07,"headphone_purple",12),"Head")
skin(tube("Headphone_Band_Trim",[(x,y-.045,z+.018) for x,y,z in band],.014,"neon_blue",8),"Head")
# hoodie waveform lines 3D adhering to body front
wave=[(-.51,3.28),(-.45,3.29),(-.405,3.35),(-.37,3.18),
      (-.33,3.38),(-.29,3.25),(-.24,3.31),(-.20,3.22),
      (-.16,3.39),(-.11,3.19),(-.07,3.3),(0,3.34),
      (.05,3.17),(.095,3.42),(.14,3.24),(.19,3.32),
      (.23,3.20),(.28,3.40),(.32,3.24),(.37,3.32),
      (.41,3.27),(.48,3.28)]
for j in range(len(wave)-1):
    a,b=wave[j],wave[j+1]
    material="neon_blue" if a[0]<0 else "neon_pink"
    ob=line("Equalizer_Wave_"+str(j),(a[0],-.438,a[1]),(b[0],-.438,b[1]),.012,material)
    skin(ob,"Spine")

# Studio backdrop for renders (not included in GLB export)
stage=cylinder("RENDER_STAGE",(0,0,-.095),2.7,.16,"headphone",vertices=80)
ringpts=[(2.38*cos(2*pi*i/96),2.38*sin(2*pi*i/96),-.005) for i in range(97)]
stage_ring=tube("RENDER_STAGE_NEON",ringpts,.02,"neon_blue")
stage_objects={stage,stage_ring}
for o in stage_objects:o["render_only"]=True

# Skeletal choreography: 4 sec, 120 frames, 30 fps.
for pb in rig.pose.bones:
    pb.rotation_mode="XYZ"
frames=[1,16,31,46,61,76,91,106,121]
def keybone(n,frame,rx=0,ry=0,rz=0):
    b=rig.pose.bones[n]
    b.rotation_euler=(rx,ry,rz)
    b.keyframe_insert(data_path="rotation_euler",frame=frame,group=n)
for k,f in enumerate(frames):
    q=2*pi*k/8
    keybone("Hips",f,.055*sin(q),.085*sin(q),.10*sin(q))
    keybone("Spine",f,.08*sin(q+pi/3),.065*sin(q),.06*sin(q+pi/2))
    keybone("Chest",f,.06*sin(q),0,.13*sin(q+pi/2))
    keybone("Neck",f,.02*sin(q),.03*sin(q),.06*sin(q+pi))
    keybone("Head",f,.04*sin(q),.05*sin(q+pi/2),.09*sin(q+pi))
    for s,side in ((-1,"L"),(1,"R")):
        phase=q+(pi if s>0 else 0)
        keybone("UpperArm."+side,f,.18+.38*sin(phase),s*.12,s*(.32+.42*sin(phase+pi/3)))
        keybone("Forearm."+side,f,-.15-.40*(.5+.5*sin(phase+pi/2)),.08,s*.12)
        keybone("Hand."+side,f,.16*sin(phase),0,.08*sin(phase))
        keybone("Thigh."+side,f,.10+.28*sin(phase),.06*sin(phase),s*.055)
        keybone("Shin."+side,f,-.13-.25*(.5+.5*sin(phase+pi/2)),0,0)
        keybone("Foot."+side,f,.15*sin(phase+pi/3),0,0)
    rig.location.z=.055*(1-cos(2*q))
    rig.location.x=.09*sin(q)
    rig.keyframe_insert(data_path="location",frame=f,group="root")
bpy.context.scene.frame_start=1
bpy.context.scene.frame_end=121
bpy.context.scene.render.fps=30
bpy.context.scene.frame_set(1)
if rig.animation_data and rig.animation_data.action:
    rig.animation_data.action.name="NEON_BOY_DANCE_120F"
# Limit object organization, use stable names and collection parent rig.
for ob in objects: ob["mark_part_id"]=ob.name

# Lighting and presentation cameras.
world=bpy.context.scene.world
world.use_nodes=True
world.node_tree.nodes["Background"].inputs["Color"].default_value=(.07,.08,.14,1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value=.55
def area(name,loc,energy,color,size,target=(0,0,2.6)):
    data=bpy.data.lights.new(name,"AREA")
    data.energy=energy;data.color=color;data.shape="DISK";data.size=size
    ob=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(ob)
    ob.location=loc
    ob.rotation_euler=(Vector(target)-ob.location).to_track_quat("-Z","Y").to_euler()
    return ob
area("KEY_softbox",(-3,-5,8),900,(.83,.90,1),5)
area("FILL_cyan",(4,-3,5),510,(.15,.82,1),4)
area("RIM_magenta",(2.7,3,5),800,(1,.16,.68),3)
def camera(name,loc,target):
    dat=bpy.data.cameras.new(name)
    ob=bpy.data.objects.new(name,dat);bpy.context.collection.objects.link(ob)
    ob.location=loc
    ob.rotation_euler=(Vector(target)-ob.location).to_track_quat("-Z","Y").to_euler()
    dat.type="ORTHO";dat.ortho_scale=6.5
    bpy.context.scene.camera=ob
    return ob
bpy.context.scene.render.engine="CYCLES"
bpy.context.scene.cycles.samples=20
bpy.context.scene.render.resolution_x=600
bpy.context.scene.render.resolution_y=760
bpy.context.scene.render.resolution_percentage=100
bpy.context.scene.render.image_settings.file_format="PNG"
bpy.context.scene.render.film_transparent=False

# Save editable Blender source and animation-enabled glTF.
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,"NEON_BOY_MASTER.blend"))
for ob in bpy.context.selected_objects: ob.select_set(False)
for ob in objects: ob.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active=rig
bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT,"NEON_BOY_DANCE.glb"),
    export_format="GLB",
    use_selection=True,
    export_animations=True,
    export_skins=True)
# Static fallback. Mark Studio v2 may not support glTF skins; verify in app separately.
bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT,"NEON_BOY_STATIC.glb"),
    export_format="GLB",
    use_selection=True,
    export_animations=False,
    export_skins=False)

for name,loc,frame in [
    ("front", (0,-11.7,5.0),1),
    ("side", (11.8,0,4.8),1),
    ("back", (0,11.7,5.0),1),
    ("dance", (7.5,-9.3,6.1),20)]:
    bpy.context.scene.frame_set(frame)
    camera("CAM_"+name,loc,(0,0,2.55))
    bpy.context.scene.render.filepath=os.path.join(OUT,"preview_"+name+".png")
    bpy.ops.render.render(write_still=True)

def check_glb(path):
    blob=open(path,"rb").read()
    assert blob[:4]==b"glTF"
    size=struct.unpack_from("<I",blob,8)[0];assert size==len(blob)
    l=struct.unpack_from("<I",blob,12)[0]
    doc=json.loads(blob[20:20+l].decode())
    return {"bytes":len(blob),"meshes":len(doc.get("meshes",[])),
            "nodes":len(doc.get("nodes",[])),"skins":len(doc.get("skins",[])),
            "animations":len(doc.get("animations",[])),
            "materials":len(doc.get("materials",[]))}
checks={
    "animated_glb":check_glb(os.path.join(OUT,"NEON_BOY_DANCE.glb")),
    "static_glb":check_glb(os.path.join(OUT,"NEON_BOY_STATIC.glb")),
    "preview_images":sorted(n for n in os.listdir(OUT) if n.endswith(".png")),
    "scene":"Blender authored; MARK Studio UI and Huawei device remain untested",
    "reference":"Stylized interpretation; not a photogrammetric reproduction"}
assert checks["animated_glb"]["animations"]>=1,checks
assert checks["animated_glb"]["skins"]>=1,checks
with open(os.path.join(OUT,"validation.json"),"w",encoding="utf-8") as f:
    json.dump(checks,f,ensure_ascii=False,indent=2)
print("MARK_EXPORT_SUCCESS",json.dumps(checks))
