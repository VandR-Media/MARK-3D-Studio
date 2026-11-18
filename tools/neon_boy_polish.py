"""Art-directed second pass for Neon Boy.
Runs from neon_boy_builder.py after primitives are authored and skinned,
before animation / exporting. All details remain genuine 3D meshes.
"""
import bpy, math
from mathutils import Vector
from math import sin, cos, pi, atan2, sqrt, exp
# Utility to remove an old proxy and its export-selection reference.
def _remove_proxy(name):
    ob=bpy.data.objects.get(name)
    if ob:
        if ob in objects:
            objects.remove(ob)
        bpy.data.objects.remove(ob,do_unlink=True)
def _smoothed(obj,levels=1):
    """Apply subdivision before armature, preserving interpolated skin weights."""
    if obj is None: return
    m=obj.modifiers.new("Sculpted_Fabric_Smoothing","SUBSURF")
    m.levels=levels;m.render_levels=levels
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active=obj
    for _ in range(len(obj.modifiers)+1):
        if obj.modifiers[0]==m:break
        bpy.ops.object.modifier_move_up(modifier=m.name)
    bpy.ops.object.modifier_apply(modifier=m.name)
    obj.select_set(False)
def _skin_shape(obj,bone,material):
    if material: obj.data.materials.clear();obj.data.materials.append(M[material])
    return skin(obj,bone)
def _look_at(v):
    return (Vector(v))
# ---------- Redo the principal garment silhouettes ----------
for letter,s in (("L",-1),("R",1)):
    pant=bpy.data.objects.get("CargoPants_"+letter)
    if pant:
        cx=s*.48
        for v in pant.data.vertices:
            z=v.co.z
            old_x=v.co.x-cx
            old_y=v.co.y-.025
            # A tapered trouser with controlled bulk near knee and hip.
            if z>1.95: fac=.86
            elif z>1.38: fac=.83
            elif z>.75: fac=.80
            else: fac=.86
            theta=atan2(old_y,old_x)
            crease=(.015*sin(20*z+2.2*theta)+.012*sin(34*z+4*theta))
            fac*=1+crease
            v.co.x=cx+old_x*fac
            v.co.y=.025+old_y*(fac*.94)
            # Subtle uneven weight and fabric sag at the knee
            if 1.1<z<1.75:
                v.co.x+=s*.018*sin(theta*2.1+z*5)
        _smoothed(pant,1)
    sleeve=bpy.data.objects.get("Hoodie_Sleeve_"+letter)
    if sleeve:
        # Refine the sleeve cross-section around its arm centerline,
        # avoid the severe bulges in the older toy-like model.
        steps=24
        pts=[(s*.66,0,3.70),(s*.80,-.005,3.63),
             (s*.90,-.01,3.46),(s*1.015,-.015,3.22),
             (s*1.08,-.015,3.02),(s*1.10,-.042,2.82),
             (s*1.15,-.060,2.64),(s*1.205,-.075,2.52)]
        for i,v in enumerate(sleeve.data.vertices):
            idx=min(len(pts)-1,i//steps)
            c=Vector(pts[idx]);a=v.co-c
            theta=atan2(a.y,a.z)
            sc=[.86,.89,.86,.84,.80,.83,.88,.96][idx]
            sc*=1+.03*sin(idx*2.6+theta*4.0)
            v.co=c+a*sc
        _smoothed(sleeve,2)
    # Sleeve and trouser surface stitches are bone-attached and visible from all angles.
    for side in (-1,1):
        # Long outseam on trouser (thin enough to read as sewing, not armor).
        points=[]
        for z in (2.14,2.02,1.83,1.61,1.37,1.15,.92,.70):
            x=s*(.48+.28+.018*cos(z*8))
            points.append((x, -.055,z))
        seam=tube("Cargo_OuterSeam_"+letter+str(side),points,.0065,"cargo_light",6)
        skin(seam,"Thigh."+letter if side<0 else "Shin."+letter)
        break
    # Asymmetric creases: overlay thin physical wrinkles in shadow tone.
    for j,(z,span,direction) in enumerate([(1.81,.22,-1),(1.27,.21,1),(.94,.17,-1),(.72,.13,1)]):
        c=s*.48
        pts=[(c+dx,-.285+abs(dx)*.08,z+direction*dx*.23) for dx in (-span,-span*.5,0,span*.5,span)]
        skin(tube("Cargo_Crease_"+letter+str(j),pts,.010,"cargo_dark"),"Thigh."+letter if z>=1.27 else "Shin."+letter)
    # Knee cloth pinch (separate deformed edge).
    skin(tube("Knee_Pleat_"+letter,[(s*.48-.23,-.21,1.27),(s*.48,-.284,1.235),(s*.48+.22,-.21,1.26)],.009,"cargo_light"),"Shin."+letter)

body=bpy.data.objects.get("Tailored_Hoodie_Body")
if body:
    for v in body.data.vertices:
        z=v.co.z
        # Narrow in the upper chest like real child's fabric rather than a barrel.
        if z>3.05:
            fac=.93 + .04*sin((z-3.05)*3.1)
        else:
            fac=.97
        v.co.x*=fac
        v.co.y*=fac
    _smoothed(body,1)
# Hood from a sewn, draping shell, replaces giant proxy sphere.
_remove_proxy("Hood_Loose_Back")
hood,st=ring_loft("Hood_Cloth_Back",[
    (3.61,0,.265,.46,.18),(3.68,0,.30,.58,.24),
    (3.78,0,.31,.55,.27),(3.89,0,.27,.48,.25),
    (3.99,0,.23,.36,.21),(4.05,0,.18,.20,.14)
],"hoodie_top",32)
skin(hood,"Chest")
_smoothed(hood,1)
skin(tube("Hood_Center_Seam",[(0,.52,3.64),(0,.57,3.76),(0,.51,3.91),(0,.37,4.02)],.010,"hoodie_seam"),"Chest")
skin(tube("Hood_Outer_Edge_L",[(-.48,-.02,3.69),(-.54,.07,3.85),(-.33,-.05,4.035)],.018,"hoodie_black"),"Chest")
skin(tube("Hood_Outer_Edge_R",[(.48,-.02,3.69),(.54,.07,3.85),(.33,-.05,4.035)],.018,"hoodie_black"),"Chest")
# Cloth fold ridges along the chest and side waist: sewn into the garment, not UI overlay.
for side in (-1,1):
    skin(tube("Hoodie_Underarm_Fold_"+str(side),[
        (side*.64,-.28,3.46),(side*.57,-.379,3.27),(side*.69,-.31,2.98)],.014,"hoodie_seam"),"Spine")
    skin(tube("Hoodie_Bottom_Fold_"+str(side),[
        (side*.35,-.413,2.61),(side*.53,-.379,2.59),(side*.68,-.23,2.56)],.011,"hoodie_top"),"Hips")
# Pocket welt and tiny corner seams.
pocket=bpy.data.objects.get("Kangaroo_Pocket")
if pocket:
    # reduce protrusion, it should look like sewn cloth pocket.
    pocket.scale.y=.64
    skin(tube("Pouch_Top_Stitch",[(-.44,-.512,2.98),(0,-.513,2.99),(.44,-.512,2.98)],.0085,"hoodie_seam"),"Spine")
# Add striped fabric grain to cuffs as actual 3D ribs.
for letter,s in (("L",-1),("R",1)):
    c=Vector((s*1.205,-.075,2.52))
    for j in range(13):
        a=2*pi*j/13
        x=c.x+.178*cos(a);y=c.y+.173*sin(a)
        skin(line("Sleeve_Cuff_Rib_"+letter+str(j),(x,y,2.465),(x,y,2.55),.006,"hoodie_seam"),"Forearm."+letter)
    cx=s*.48
    for j in range(13):
        a=2*pi*j/13
        x=cx+.215*cos(a);y=.01+.225*sin(a)
        skin(line("Cargo_Ankle_Rib_"+letter+str(j),(x,y,.545),(x,y,.648),.006,"hoodie_seam"),"Shin."+letter)
# ---------- Face art pass ----------
face=bpy.data.objects.get("Head_Facial_Topology")
if face:
    # Gentle jaw and cheek projection, preserving a shared head surface.
    for v in face.data.vertices:
        x,y,z=v.co
        if y < -.12:
            cheek=exp(-((abs(x)-.255)/.17)**2-((z-4.34)/.17)**2)
            chin=exp(-(x/.26)**2-((z-4.20)/.11)**2)
            v.co.y-=.045*cheek + .018*chin
        # Upper skull slightly broader, jaw tapered.
        if z<4.40:
            v.co.x*=.92
    _smoothed(face,1)
# Replace spherical toy nose with softly layered bridge and nostrils.
_remove_proxy("NoseTip")
skin(ball("NoseBridge",(0,-.337,4.426),(.052,.042,.124),"skin",20,16),"Head")
skin(ball("NoseSoftTip",(0,-.388,4.347),(.077,.05,.055),"skin",24,16),"Head")
for s,letter in ((-1,"L"),(1,"R")):
    skin(ball("NostrilWing_"+letter,(s*.068,-.355,4.337),(.034,.031,.025),"skin",16,10),"Head")
    skin(ball("SmileDimple_"+letter,(s*.225,-.334,4.263),(.033,.014,.026),"cheek",16,10),"Head")
    # Almond upper and lower eyelid meshes following the eye geometry.
    skin(tube("Eyelid_Upper_"+letter,[
        (s*.085,-.365,4.563),(s*.135,-.376,4.610),
        (s*.187,-.382,4.619),(s*.248,-.365,4.600),
        (s*.277,-.349,4.566)],.016,"skin_shade",8),"Head")
    skin(tube("Eyelid_Lower_"+letter,[
        (s*.095,-.354,4.505),(s*.158,-.378,4.485),
        (s*.211,-.366,4.492),(s*.273,-.339,4.52)],.009,"skin",8),"Head")
    skin(ball("Iris_Catchlight_Extra_"+letter,(s*.151,-.388,4.551),(.011,.006,.012),"white",12,8),"Head")
    # Tiny crease close to upper cheek.
    skin(tube("SmileCrease_"+letter,[
        (s*.245,-.33,4.28),(s*.27,-.317,4.305),(s*.28,-.31,4.329)],.0075,"skin_shade",8),"Head")
skin(ball("LowerLip",(0,-.354,4.224),(.155,.016,.020),"cheek",20,12),"Head")
# Hair: natural dark nape and a few tapered bangs, no bead-like fringe.
for j in range(7):
    _remove_proxy("Fringe_"+str(j))
for j in range(5):
    x=-.295+j*.14
    # small pointed custom strands
    skin(tube("RealHair_Tuft_"+str(j),[
        (x,-.295,4.806),(x+.035,-.33,4.77),(x+.05,-.36,4.727)],.032 if j%2 else .025,"hair",6),"Head")
# A curved forehead hairline visible below brim.
skin(tube("Hairline",[(x,-.285-.018*cos(x*9),4.783-.014*cos(2*x)) for x in [-.32,-.24,-.16,-.08,0,.08,.16,.24,.32]],.012,"hair",8),"Head")
# ---------- Cap, back strap, headphone mechanical detail ----------
# Thin lip around the visor perimeter
skin(tube("Visor_Binding",[
    (-.40,-.40,4.742),(-.30,-.54,4.730),(0,-.745,4.718),
    (.30,-.54,4.730),(.40,-.40,4.742)],.017,"cap_shadow"),"Head")
for side in (-1,1):
    # cap sewn panel curves
    skin(tube("Cap_PanelSeam_"+str(side),[
        (side*.22,-.32,4.84),(side*.22,-.32,4.97),
        (side*.17,-.21,5.09),(side*.06,-.02,5.128)],.007,"cap_shadow",6),"Head")
    # small ventilation holes as dark circles
    skin(ball("Cap_Eyelet_"+str(side),(side*.26,-.218,5.01),(.012,.007,.012),"cap_shadow",12,8),"Head")
# Back cap opening and fastening from physical meshes.
skin(cube("Cap_Back_Adjuster",(0,.352,4.89),(.28,.035,.08),"cap_shadow",.015),"Head")
for k in range(5):
    skin(ball("Cap_Back_Snap_"+str(k),(-.095+k*.047,.374,4.887),(.008,.007,.008),"shoe_white",8,6),"Head")
# A band and earcup thickness details (physical on 3d parts).
for side,s in (("L",-1),("R",1)):
    c=(s*.57,0,4.54)
    skin(cube("Headset_Hinge_"+side,(s*.56,.04,4.854),(.095,.16,.18),"headphone",.017),"Head")
    skin(cube("Headset_Slider_"+side,(s*.557,.055,4.98),(.085,.115,.18),"shoe_grey",.010),"Head")
    # Rigid ear padding outer seam, ring follows cup circumference in actual 3D.
    pts=[(s*.47,.285*cos(2*pi*i/48),4.54+.285*sin(2*pi*i/48)) for i in range(49)]
    skin(tube("EarCushion_Stitch_"+side,pts,.012,"hoodie_black",8),"Head")
# ---------- Sneakers ----------
for side,s in (("L",-1),("R",1)):
    cx=s*.48
    # Heel outsole layer in neutral grey, neon shoe accent starts at back.
    for z,material,r in ((.12,"shoe_grey",.012),(.19,"neon_pink",.017)):
        skin(tube("Sneaker_Heel_Trim_"+side+str(z),[
            (cx-.21,.32,z),(cx-.13,.39,z),(cx,.412,z),
            (cx+.13,.39,z),(cx+.21,.32,z)],r,material,8),"Foot."+side)
    # 3D sneaker panel stitching and side geometric strips.
    for j in range(3):
        y=-.32+j*.13
        skin(tube("Sneaker_SideStitch_"+side+str(j),[
            (cx+s*.23,y-.1,.29),(cx+s*.275,y,.34),
            (cx+s*.225,y+.09,.36)],.009,"shoe_grey"),"Foot."+side)
    # Real lace eyelets across sneaker tongue
    for j in range(5):
        y=-.31+j*.105
        for sx in (-1,1):
            skin(ball("LaceEyelet_"+side+str(j)+str(sx),(cx+sx*.146,y,.467),(.018,.013,.009),"shoe_grey",12,8),"Foot."+side)
# ---------- Functional wristwatch ----------
s=-1;letter="L"
skin(tube("Smartwatch_Band",[
    (s*1.23+.08*cos(2*pi*i/24),-.10+.09*sin(2*pi*i/24),2.43) for i in range(25)],.04,"headphone"),"Hand."+letter)
watch=cube("Smartwatch_Face",(s*1.235,-.205,2.432),(.19,.047,.15),"headphone",.025)
skin(watch,"Hand."+letter)
skin(cube("Smartwatch_Screen",(s*1.235,-.231,2.432),(.135,.012,.098),"neon_blue",.012),"Hand."+letter)
# ---------- Additional rear pockets, seams ----------
for side,s in (("L",-1),("R",1)):
    cx=s*.48
    backp=cube("Cargo_RearPocket_"+side,(cx,.31,2.03),(.38,.08,.30),"cargo_light",.025)
    skin(backp,"Thigh."+side)
    skin(tube("RearPocketV_"+side,[
        (cx-.135,.36,2.06),(cx,.368,1.94),(cx+.135,.36,2.06)],.008,"cargo_dark"),"Thigh."+side)
# Stable material names to simplify interactive recoloring.
for ob in objects:
    if ob.type=="MESH":
        ob["mark_editable"]=True
        ob["mark_unit"]="meter"
print("MARK_POLISH_SUCCESS",len(objects))
