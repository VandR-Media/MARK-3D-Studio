"""Neon Boy V5 — sculpted hoodie boy, PBR recoloring, bone-driven dance.
Base character CC0: Grab3D hoodie-teen-rigged; retain authored body, clothes and textures.
NOT a sphere-built humanoid.
"""
import bpy, bmesh, math, os, json, struct
from pathlib import Path
from mathutils import Vector, Quaternion
from math import sin,cos,pi
import numpy as np
OUT=Path("output");OUT.mkdir(exist_ok=True)
bpy.ops.object.select_all(action="SELECT");bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(Path("teen_rigged.glb").absolute()))
body=max((o for o in bpy.data.objects if o.type=="MESH"),key=lambda o:len(o.data.vertices))
rig=next(o for o in bpy.data.objects if o.type=="ARMATURE")
body.name="NeonBoy_Sculpted_Body_Hoodie_Cargo";rig.name="NeonBoy_Rig"
for o in list(bpy.data.objects):
    if o.type=="MESH" and o is not body:bpy.data.objects.remove(o,do_unlink=True)
# Neutralise imported walk/run clips before dressing and custom animation.
for o in bpy.data.objects:
    if o.animation_data:o.animation_data_clear()
for action in list(bpy.data.actions):bpy.data.actions.remove(action)
for pb in rig.pose.bones:
    pb.rotation_mode="XYZ";pb.rotation_euler=(0,0,0);pb.location=(0,0,0)
    pb.scale=(1,1,1)
bpy.context.view_layer.update()

# Remove source backpack and the two original backpack straps (the reference has none).
# Detect strap islands from their material color in the actual UV atlas; preserve
# green hoodie fabric and skin, using spatial and material constraints together.
bm=bmesh.new();bm.from_mesh(body.data)
world=body.matrix_world.copy()
uv_layer=bm.loops.layers.uv.active
base_src=next((n.image for ma in body.data.materials if ma and ma.use_nodes
  for n in ma.node_tree.nodes if n.type=="TEX_IMAGE" and n.image and
  any(l.from_node==n and l.to_socket.name=="Base Color" for l in ma.node_tree.links)),None)
atlas=None
if base_src:
    tw,th=base_src.size
    atlas=np.empty(tw*th*4,dtype=np.float32)
    base_src.pixels.foreach_get(atlas)
    atlas=atlas.reshape((th,tw,4))
cut=[];removed_back=0;removed_strap=0
for face in bm.faces:
    w=world@face.calc_center_median()
    # Remove protruding rear accessories and shoulder-bag hardware.
    if .80<w.z<1.45 and -.31<w.x<.31 and w.y>.078:
        cut.append(face);removed_back+=1
        continue
    # On the chest, remove neutral-grey / cream strap polygons, not cloth.
    if .91<w.z<1.47 and .052<abs(w.x)<.24 and w.y<-.095 and atlas is not None and uv_layer:
        cs=[]
        for loop in face.loops[:3]:
            uv=loop[uv_layer].uv
            px=int(max(0,min(tw-1,uv.x*tw)))
            py=int(max(0,min(th-1,uv.y*th)))
            cs.append(atlas[py,px,:3])
        color=np.mean(cs,axis=0)
        # Neutral textile straps; hoodie is clearly green in the source texture.
        neutral=float(max(color)-min(color))
        if neutral<.105 and float(np.mean(color))>.15:
            cut.append(face);removed_strap+=1
bmesh.ops.delete(bm,geom=cut,context="FACES")
bm.to_mesh(body.data);bm.free();body.data.update()
print("V6_REMOVED_BACKPACK_AND_STRAPS",removed_back,removed_strap,flush=True)

def rgb(h):
    def channel(q):
        v=int(q,16)/255
        return v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4
    return tuple(channel(h[i:i+2]) for i in (1,3,5))+(1,)
def material(n,h,metal=0,rough=.7,emit=0):
    m=bpy.data.materials.new(n);m.use_nodes=True
    m.diffuse_color=rgb(h)
    bs=m.node_tree.nodes.get("Principled BSDF")
    bs.inputs["Base Color"].default_value=rgb(h)
    bs.inputs["Roughness"].default_value=rough
    bs.inputs["Metallic"].default_value=metal
    if emit:
        bs.inputs["Emission Color"].default_value=rgb(h)
        bs.inputs["Emission Strength"].default_value=emit
    return m
M={
 "cap":material("Crimson baseball cotton","#920921",rough=.87),
 "cap_edge":material("Cap stitched rim","#520719",rough=.88),
 "white":material("White embroidery and laces","#E6E8F5",rough=.75),
 "cyan":material("Cyan emissive LED","#0ACEFC",rough=.35,emit=2.7),
 "pink":material("Magenta emissive LED","#FD41CF",rough=.35,emit=2.3),
 "lightcyan":material("Woven cyan waveform","#20CAFE",rough=.7,emit=.9),
 "lightpink":material("Woven pink waveform","#ED54BF",rough=.7,emit=.9),
 "pad":material("Synthetic leather ear pad","#151A2B",rough=.78),
 "cup":material("Dark polymer ear cup","#1A2038",metal=.18,rough=.44),
 "steel":material("Graphite satin metal","#596176",metal=.7,rough=.31),
 "watch":material("Smartwatch polymer","#10131C",rough=.55),
 "lace":material("Sneaker cyan highlights","#17CDFF",rough=.54,emit=.7),
}
# Recolor the existing sophisticated physically textured garment
# (no shape destruction): green cotton -> dark navy, pale denim -> charcoal.
# Preserve original fabric detail, stitching, skin tone, iris and short dark hair.
base=None
for m in body.data.materials:
    if not m or not m.use_nodes:continue
    for link in m.node_tree.links:
        if link.to_node.type=="BSDF_PRINCIPLED" and link.to_socket.name=="Base Color" and link.from_node.type=="TEX_IMAGE":
            base=link.from_node.image
            break
    if base:break
if base:
    width,height=base.size
    arr=np.empty(width*height*4,dtype=np.float32)
    base.pixels.foreach_get(arr);arr=arr.reshape((height,width,4))
    # In Blender image pixel values are scene-linear. Hue dominance masks
    # work in either space; coefficients preserve fold-light values.
    r,g,b=arr[:,:,0],arr[:,:,1],arr[:,:,2]
    green=(g>r*1.12)&(g>b*1.07)&(g>.065)&(r>.018)&(b>.015)
    blue=(b>r*1.12)&(b>g*1.06)&(b>.09)&(r>.04)&(g>.06)&(~green)
    lum=.25*r+.65*g+.10*b
    new=arr.copy()
    new[green,0]=lum[green]*.081
    new[green,1]=lum[green]*.09
    new[green,2]=lum[green]*.235
    new[blue,0]=lum[blue]*.29
    new[blue,1]=lum[blue]*.29
    new[blue,2]=lum[blue]*.36
    # Precise torso UV mask: recolor off-white backpack straps and hoodie
    # stripe without changing white sneakers, irises or peach skin.
    uv=body.data.uv_layers.active
    white_mask=np.zeros((height,width),dtype=np.bool_)
    filled_triangles=0
    if uv:
        for poly in body.data.polygons:
            pt=body.matrix_world@poly.center
            if not((.83<pt.z<1.47 and abs(pt.x)<.47) or (.20<pt.z<.85 and abs(pt.x)<.32)):
                continue
            corners=[]
            for li in poly.loop_indices:
                co=uv.data[li].uv
                corners.append((co.x*width,co.y*height))
            if len(corners)<3:continue
            tri=corners[:3]
            xlo=max(0,int(min(p[0] for p in tri)))
            xhi=min(width-1,int(max(p[0] for p in tri))+1)
            ylo=max(0,int(min(p[1] for p in tri)))
            yhi=min(height-1,int(max(p[1] for p in tri))+1)
            if xhi<xlo or yhi<ylo or (xhi-xlo+1)*(yhi-ylo+1)>9000:
                continue
            xa,ya=tri[0];xb,yb=tri[1];xc,yc=tri[2]
            det=(yb-yc)*(xa-xc)+(xc-xb)*(ya-yc)
            if abs(det)<1e-5:continue
            yy,xx=np.mgrid[ylo:yhi+1,xlo:xhi+1]
            a=((yb-yc)*(xx-xc)+(xc-xb)*(yy-yc))/det
            b0=((yc-ya)*(xx-xc)+(xa-xc)*(yy-yc))/det
            inside=(a>=-.05)&(b0>=-.05)&(a+b0<=1.05)
            white_mask[ylo:yhi+1,xlo:xhi+1] |= inside
            filled_triangles+=1
    nearwhite=(r>.39)&(g>.38)&(b>.35)&(abs(r-g)<.24)
    # Neutral grey straps share the atlas with garments: recolor those
    # pixels within cloth UV islands, preserving facial skin and shoes.
    neutral=(np.abs(r-g)<.095)&(np.abs(g-b)<.095)&(lum>.08)&(lum<.8)
    neutral_cloth=white_mask&neutral
    new[neutral_cloth,0]=lum[neutral_cloth]*.12
    new[neutral_cloth,1]=lum[neutral_cloth]*.14
    new[neutral_cloth,2]=lum[neutral_cloth]*.22
    cover=white_mask&nearwhite
    new[cover,0]=lum[cover]*.09
    new[cover,1]=lum[cover]*.095
    new[cover,2]=lum[cover]*.15
    # Also reduce bright denim speckles while preserving source material relief.
    blue_splotch=(blue)&(white_mask)&(lum>.45)
    new[blue_splotch,0]*=.70;new[blue_splotch,1]*=.70;new[blue_splotch,2]*=.70
    print("FABRIC_UV_MASK",filled_triangles,int(cover.sum()),int(blue_splotch.sum()),int(neutral_cloth.sum()),flush=True)
    new_img=bpy.data.images.new("NeonBoy_NavyHoodie_CharcoalCargo_PBR",width=width,height=height,alpha=True)
    new_img.pixels.foreach_set(new.reshape(-1));new_img.file_format="PNG"
    new_img.filepath_raw=str(OUT.joinpath("NeonBoy_ColorTexture.png").absolute())
    new_img.save()
    for m in body.data.materials:
        if m and m.use_nodes:
            for node in m.node_tree.nodes:
                if node.type=="TEX_IMAGE" and node.image==base:
                    node.image=new_img
    new_img.pack()
    print("RECOLORED_NATURAL_FABRIC",width,height,int(green.sum()),int(blue.sum()),flush=True)
else:
    print("WARNING: ORIGINAL_BASE_TEXTURE_NOT_FOUND",flush=True)

# Custom actual 3D solids. All props are rigidly parented to the relevant 53-style
# (here 24-bone) humanoid joints; none are screen-space overlays.
parts=[]
def create(n,verts,faces,material,bone=None):
    md=bpy.data.meshes.new(n+"_mesh");md.from_pydata(verts,[],faces);md.update()
    ob=bpy.data.objects.new(n,md);bpy.context.collection.objects.link(ob)
    ob.data.materials.append(M[material] if isinstance(material,str) else material)
    for p in ob.data.polygons:p.use_smooth=True
    ob["MARK_ID"]=n
    if bone:
        world=ob.matrix_world.copy()
        ob.parent=rig;ob.parent_type="BONE";ob.parent_bone=bone
        ob.matrix_world=world
    parts.append(ob);return ob
def tube(n,points,r,material,bone,steps=10):
    ps=[Vector(p) for p in points];verts=[];faces=[]
    for i,p in enumerate(ps):
        d=(ps[min(i+1,len(ps)-1)]-ps[max(0,i-1)]).normalized()
        u=d.cross(Vector((0,0,1)) if abs(d.z)<.9 else Vector((0,1,0))).normalized()
        v=d.cross(u).normalized()
        for k in range(steps):
            q=p+r*(u*cos(2*pi*k/steps)+v*sin(2*pi*k/steps))
            verts.append(tuple(q))
    for i in range(len(ps)-1):
        for k in range(steps):
            a=i*steps+k;b=i*steps+(k+1)%steps
            faces.append((a,b,b+steps,a+steps))
    faces.append(tuple(reversed(range(steps))))
    faces.append(tuple((len(ps)-1)*steps+k for k in range(steps)))
    return create(n,verts,faces,material,bone)
def dome(n,rings,material,bone,steps=48):
    # each ring (height,xcentre,ycentre,radius_x,radius_y)
    vs=[];fs=[]
    for z,xc,yc,rx,ry in rings:
        for i in range(steps):
            t=2*pi*i/steps
            vs.append((xc+rx*cos(t),yc+ry*sin(t),z))
    for j in range(len(rings)-1):
        for k in range(steps):
            a=j*steps+k;b=j*steps+(k+1)%steps
            fs.append((a,b,b+steps,a+steps))
    fs.append(tuple(reversed(range(steps))))
    fs.append(tuple((len(rings)-1)*steps+k for k in range(steps)))
    return create(n,vs,fs,material,bone)
def patch(n,vs,mat,bone):
    return create(n,vs,[(0,1,2),(0,2,3)],mat,bone)
# Hat preserves natural original hair; tailors on top, no fake face replacement.
dome("Crown_Crimson_Cotton",[
 (1.617,0,.020,.138,.116),
 (1.64,0,.021,.155,.120),
 (1.69,0,.021,.161,.130),
 (1.741,0,.022,.147,.122),
 (1.789,0,.025,.111,.094),
 (1.81,0,.024,.061,.049),
 (1.817,0,.024,.015,.016)],"cap","Head")
for side in (-1,1):
    tube("Cap_Panel_Seam_"+str(side),[
       (side*.078,-.101,1.64),(side*.095,-.095,1.72),
       (side*.059,-.041,1.789)],.0028,"cap_edge","Head",8)
# Brim is curved shell, not a floating flat rectangle.
V=[];F=[];N=36
for y,w,z in [(-.094,.15,1.626),(-.20,.156,1.60),(-.29,.126,1.581)]:
    for k in range(N):
        t=2*k/(N-1)-1
        V.append((t*w,y+.014*t*t,z+.01*t*t))
for j in range(2):
    for k in range(N-1):
        a=j*N+k;F.append((a,a+1,a+N+1,a+N))
visor=create("Sculpted_Cap_Visor",V,F,"cap","Head")
sol=visor.modifiers.new("VisorThickness","SOLIDIFY");sol.thickness=.009
tube("Cap_Visor_Piping",[(-.12,-.28,1.589),(-.06,-.29,1.582),(0,-.29,1.581),(.06,-.29,1.582),(.12,-.28,1.589)],
     .0035,"cap_edge","Head")
for k,(a,b) in enumerate([
 ((-.062,1.685),(-.062,1.74)),((-.062,1.74),(0,1.699)),((0,1.699),(.062,1.74)),((.062,1.74),(.062,1.685))]):
    tube("Real_Embroidered_Logo_M_%d"%k,[(a[0],-.113,a[1]),(b[0],-.113,b[1])],.0045,"white","Head",8)
# RGB headphones with real world geometry, no sticker UI
for side in (-1,1):
    x=side*.181;z=1.559
    for rr,mat,rsize in [(.078,"pad",.015),(.065,"cup",.023),
                         (.059,"pink",.0048),(.046,"cyan",.0045)]:
        ps=[(x+(side*.018 if mat!="pad" else 0),
             rr*cos(2*pi*j/60),z+rr*sin(2*pi*j/60)) for j in range(61)]
        tube("EarCup_%d_%s"%(side,mat),ps,rsize,mat,"Head",12)
    tube("Headset_Adjustable_Hinge_"+str(side),
        [(side*.168,.003,1.631),(side*.167,.014,1.706),(side*.125,.014,1.780)],
        .012,"steel","Head")
    x=side*.218
    for j,(a,b) in enumerate([((-.022,1.54),(-.022,1.578)),
       ((-.022,1.578),(0,1.55)),((0,1.55),(.022,1.578)),((.022,1.578),(.022,1.54))]):
        tube("Earcup_M_%d_%d"%(side,j),[(x,a[0],a[1]),(x,b[0],b[1])],.004,"cyan","Head",8)
# Main band above cap.
band=[(.171*cos(pi*j/60),.010,1.555+.263*sin(pi*j/60)) for j in range(61)]
tube("Headphone_Arch",band,.013,"cup","Head")
tube("Headphone_Arch_Cyan_Trim",[(x,y-.008,z+.009) for x,y,z in band],.003,"cyan","Head")
# Real fabric-mounted chest waveform; visually follows hoodie instead of text UI
# (the 3D geometry is attached to Spine and dances with the torso).
W=[(-.17,1.20),(-.145,1.205),(-.13,1.235),(-.114,1.167),
 (-.097,1.248),(-.078,1.20),(-.058,1.223),(-.043,1.173),
 (-.025,1.251),(-.01,1.194),(.015,1.229),(.031,1.173),
 (.045,1.244),(.061,1.188),(.077,1.237),(.092,1.194),
 (.113,1.239),(.13,1.198),(.15,1.202),(.172,1.205)]
for i in range(len(W)-1):
    a,b=W[i:i+2]
    tube("Neon_Chest_Equalizer_%02d"%i,
         [(a[0],-.157,a[1]),(b[0],-.157,b[1])],.0032,
         "lightcyan" if a[0]<.008 else "lightpink","Spine",8)
# Cloth-mounted cargo pockets, close-fitting to the sculpted trouser surface.
# Small layered fabric faces with a proper flap, never large hanging boxes.
cargo_m=material("Cargo_Pocket_Twill","#333845",rough=.94)
cargo_seam=material("Cargo_Stitch_Thread","#656979",rough=.92)
M["cargo"]=cargo_m;M["cargo_stitch"]=cargo_seam
for sign,side in [(-1,"Left"),(1,"Right")]:
    bn=side+"UpLeg"
    x=sign*.166
    verts=[
       (x,-.055,.695),(x+sign*.014,-.053,.695),
       (x+sign*.018,.055,.695),(x,.063,.695),
       (x,-.060,.55),(x+sign*.016,-.061,.55),
       (x+sign*.020,.055,.55),(x,.065,.55)]
    faces=[(0,1,5,4),(1,2,6,5),(2,3,7,6)]
    pocket=create("Sewn_Cargo_Pocket_"+side,verts,faces,"cargo",bn)
    solid=pocket.modifiers.new("CottonPocketShell","SOLIDIFY")
    solid.thickness=.003
    tube("Cargo_Flap_Stitch_"+side,[
        (x,-.058,.68),(x+sign*.015,-.056,.685),
        (x+sign*.019,.053,.685),(x,.063,.68)],.0018,"cargo_stitch",bn,8)
    tube("Cargo_Base_Stitch_"+side,[
        (x,-.06,.555),(x+sign*.016,-.061,.554),
        (x+sign*.020,.055,.554)],.0015,"cargo_stitch",bn,8)

# Animated trim on sleeves. Fashion accessory geometry follows skinning bones.
for sign,side in [(-1,"Left"),(1,"Right")]:
    for seg,bone,coords in [
        ("upper",side+"Arm",[(sign*.192,-.067,1.338),(sign*.239,-.052,1.28),(sign*.31,-.033,1.18)]),
        ("lower",side+"ForeArm",[(sign*.316,-.03,1.177),(sign*.374,-.018,1.094),(sign*.423,-.015,1.02)])]:
        tube("Sleeve_RGB_%s_%s"%(side,seg),coords,.008,
             "cyan" if seg=="upper" else "pink",bone,10)
    # sneaker heel accent, physical 3D line follows the foot
    tube("Sneaker_LED_Edge_"+side,[(sign*.1,.075,.104),(sign*.16,.087,.107),(sign*.222,.067,.103)],
         .008,"cyan",side+"Foot")
# smartwatch near left wrist
patch("Smartwatch_Screen",[(-.422,-.064,1.02),(-.376,-.075,1.02),
                           (-.376,-.075,1.06),(-.422,-.064,1.06)],"cyan","LeftHand")

# Artistic QA: eliminate protruding light rods and reveal the eyes.
for ob in list(parts):
    if ob.name.startswith(("Sleeve_RGB_","Sneaker_LED_Edge_","Smartwatch_Screen")):
        parts.remove(ob)
        bpy.data.objects.remove(ob,do_unlink=True)
# Cap stays above the brow and follows the real rigged head.
for ob in parts:
    if ob.name.startswith(("Crown_","Cap_Panel_","Sculpted_Cap_Visor",
                           "Cap_Visor_","Real_Embroidered_Logo_")):
        for vert in ob.data.vertices:
            vert.co.z+=.079
            if "Visor" in ob.name and vert.co.y<-.12:
                vert.co.y=-.12+(vert.co.y+.12)*.78
    if ob.name.startswith("Headphone_Arch"):
        for vert in ob.data.vertices:
            k=max(0,min(1,(vert.co.z-1.56)/.18))
            vert.co.z+=.066*k
# Organic hoodie's rear surface, reconstructed as a single draped cloth patch.
# The original CC0 source includes an unwanted backpack, removed above.
# This patch follows variable torso width and rounded back curvature.
nv=36;nz=40;pts=[];fs=[]
for iz in range(nz):
    zz=.825+iz*(.58/(nz-1))
    t=(zz-.825)/.58
    # waist slimmer, shoulders broader; narrow upper neckline
    width=.188 + .043*sin(pi*t) - .065*(max(0,(t-.76)/.24))**1.2
    for ix in range(nv):
        u=2*ix/(nv-1)-1
        xx=width*u
        bulge=(1-u*u)**.7
        # rear surface drapes toward shoulder blades with soft wrinkles
        yy=.035+.048*bulge+.009*sin(zz*25+u*7)*sin(pi*t)
        yy+=.006*sin(pi*t)
        pts.append((xx,yy,zz))
for iz in range(nz-1):
    for ix in range(nv-1):
        a=iz*nv+ix;fs.append((a,a+1,a+nv+1,a+nv))
dark_fabric=material("BackHoodie_Matte_Navy","#14182D",rough=.96)
back_panel=create("Hoodie_Draped_Rear_Cloth",pts,fs,dark_fabric,"Spine01")
sol=back_panel.modifiers.new("FabricShell","SOLIDIFY");sol.thickness=.003
# Sew along the neckline and down to the hem, physically in 3D.
tube("Hoodie_Rear_Center_Stitch",[
 (0,.086,.84),(0,.090,1.00),(0,.090,1.16),(0,.080,1.32)],.0025,
 "cap_edge","Spine01",8)
tube("Hoodie_Rear_Hem_Stitch",[
 (x,.067+.075*(1-(x/.188)**2)**.7,.836)
 for x in [-.18,-.13,-.08,0,.08,.13,.18]],.0023,
 "cap_edge","Spine01",8)

# Keyframe a new rhythmic dance clip, not simple canned walk.
for pb in rig.pose.bones:
    pb.rotation_mode="XYZ";pb.rotation_euler=(0,0,0)
action=bpy.data.actions.new("NEON_BOY_DANCE_150F")
ad=rig.animation_data_create();ad.action=action
for frame in range(1,152,10):
    t=2*pi*(frame-1)/150
    def key(bn,rx=0,ry=0,rz=0):
        pb=rig.pose.bones.get(bn)
        if pb:
            pb.rotation_euler=(rx,ry,rz)
            pb.keyframe_insert(data_path="rotation_euler",frame=frame,group=bn)
    key("Hips",.07*sin(t*2),.08*sin(t),.13*sin(t))
    key("Spine",.07*sin(t+1),.07*sin(t),.1*sin(t))
    key("Spine01",.035*sin(t*2+.6),.035*sin(t),.055*sin(t+1))
    key("Spine02",.044*sin(t+.8),.06*sin(t),.07*sin(t+pi/2))
    key("neck",.05*sin(t*2),.035*sin(t),.05*sin(t))
    key("Head",.07*sin(t*2+.8),.04*sin(t),.065*sin(t+.7))
    for sign,side in ((-1,"Left"),(1,"Right")):
        q=t+(pi if sign>0 else 0)
        key(side+"Shoulder",.03*sin(q),.04*sin(q),.06*sin(q))
        # Move arms in rig bone rest coordinates: visible alternating raises.
        pb=rig.pose.bones.get(side+"Arm")
        if pb:
            direction=1 if pb.bone.tail_local.x>pb.bone.head_local.x else -1
            yaxis=pb.bone.matrix_local.to_quaternion().inverted()@Vector((0,1,0))
            theta=-direction*(.28+.92*(.5+.5*sin(q+.4)))
            pb.rotation_mode="QUATERNION"
            pb.rotation_quaternion=Quaternion(yaxis,theta)
            pb.keyframe_insert(data_path="rotation_quaternion",frame=frame,group=side+"Arm")
        pb=rig.pose.bones.get(side+"ForeArm")
        if pb:
            direction=1 if pb.bone.tail_local.x>pb.bone.head_local.x else -1
            yaxis=pb.bone.matrix_local.to_quaternion().inverted()@Vector((0,1,0))
            theta=-direction*(.1+.55*(.5+.5*sin(q+.9)))
            pb.rotation_mode="QUATERNION"
            pb.rotation_quaternion=Quaternion(yaxis,theta)
            pb.keyframe_insert(data_path="rotation_quaternion",frame=frame,group=side+"ForeArm")
        key(side+"Hand",.08*sin(q),.05*sin(q+.8),0)
        key(side+"UpLeg",.24*sin(q),.035*sin(q),.06*sin(q))
        key(side+"Leg",-.17-.30*(.5+.5*sin(q+1.4)),0,0)
        key(side+"Foot",.10*sin(q+.3),0,0)
    rig.location=(.036*sin(t),0,.014*(1-cos(t*4)))
    rig.keyframe_insert(data_path="location",frame=frame,group="RootSway")
bpy.context.scene.frame_start=1;bpy.context.scene.frame_end=151
bpy.context.scene.render.fps=30
bpy.context.scene.frame_set(1)
# Lighting, backdrop, controlled bloom (WebGL viewer also offers glow).
world=bpy.context.scene.world
world.use_nodes=True
world.node_tree.nodes["Background"].inputs["Color"].default_value=(.07,.075,.11,1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value=.70
def area(n,pos,pow,col,size):
    d=bpy.data.lights.new(n,"AREA");d.energy=pow;d.color=col;d.shape="DISK";d.size=size
    ob=bpy.data.objects.new(n,d);bpy.context.collection.objects.link(ob)
    ob.location=pos;ob.rotation_euler=(Vector((0,0,.91))-ob.location).to_track_quat("-Z","Y").to_euler()
area("Key_Softbox",(-2.4,-3.8,5),790,(1,.89,.80),4)
area("Fill_Cyan",(3.2,-2.1,3.8),400,(.38,.78,1),4)
area("Rim_Pink",(2.4,3.0,3.5),90,(1,.31,.68),3)
def cam(n,pos):
    d=bpy.data.cameras.new(n);d.type="ORTHO";d.ortho_scale=2.23
    ob=bpy.data.objects.new(n,d);bpy.context.collection.objects.link(ob)
    ob.location=pos
    ob.rotation_euler=(Vector((0,0,.90))-ob.location).to_track_quat("-Z","Y").to_euler()
    bpy.context.scene.camera=ob
bpy.context.scene.render.engine="CYCLES";bpy.context.scene.cycles.samples=20
bpy.context.scene.render.resolution_x=610;bpy.context.scene.render.resolution_y=800
bpy.context.scene.render.resolution_percentage=100
bpy.context.scene.view_settings.view_transform="AgX"
bpy.context.scene.view_settings.look="AgX - Medium High Contrast"
# Scene lights and cameras stay in .blend; excluded from 3D character file.
bpy.ops.wm.save_as_mainfile(filepath=str(OUT.joinpath("NEON_BOY_V5_MASTER.blend").absolute()))
bpy.ops.object.select_all(action="DESELECT")
body.select_set(True);rig.select_set(True)
for ob in parts:ob.select_set(True)
bpy.context.view_layer.objects.active=rig
bpy.ops.export_scene.gltf(filepath=str(OUT.joinpath("NEON_BOY_V5_DANCE.glb").absolute()),
    export_format="GLB",use_selection=True,export_animations=True,export_skins=True)
bpy.ops.export_scene.gltf(filepath=str(OUT.joinpath("NEON_BOY_V5_STATIC.glb").absolute()),
    export_format="GLB",use_selection=True,export_animations=False,export_skins=False)
for label,pos,frame in [("front",(0,-4.5,1.6),1),("side",(4.5,0,1.6),1),
                        ("back",(0,4.5,1.6),1),("dance",(2.8,-3.7,1.8),41)]:
    bpy.context.scene.frame_set(frame)
    cam("CAM_"+label,pos)
    bpy.context.scene.render.filepath=str(OUT.joinpath("render_"+label+".png").absolute())
    bpy.ops.render.render(write_still=True)
# Real Blender frames from the skeletal dance, for a truthful motion preview.
# This is a deliberately small Cycles render, not a generated animation.
saved_resolution=(bpy.context.scene.render.resolution_x,bpy.context.scene.render.resolution_y,bpy.context.scene.cycles.samples)
bpy.context.scene.render.resolution_x=320
bpy.context.scene.render.resolution_y=440
bpy.context.scene.cycles.samples=8
cam("CAM_DanceMotion",(2.8,-3.7,1.8))
for i,frame in enumerate((1,26,51,76,101,126,151)):
    bpy.context.scene.frame_set(frame)
    bpy.context.scene.render.filepath=str(OUT.joinpath("dance_step_%02d.png"%i).absolute())
    bpy.ops.render.render(write_still=True)
bpy.context.scene.render.resolution_x,bpy.context.scene.render.resolution_y,bpy.context.scene.cycles.samples=saved_resolution

def stats(p):
    raw=p.read_bytes()
    assert raw[:4]==b"glTF" and struct.unpack_from("<I",raw,8)[0]==len(raw)
    jsonlen=struct.unpack_from("<I",raw,12)[0];data=json.loads(raw[20:20+jsonlen])
    return {"bytes":len(raw),"meshes":len(data.get("meshes",[])),
            "skins":len(data.get("skins",[])),
            "joints":sum(len(s["joints"]) for s in data.get("skins",[])),
            "animations":len(data.get("animations",[])),
            "materials":len(data.get("materials",[]))}
out={"animated":stats(OUT/"NEON_BOY_V5_DANCE.glb"),
     "static":stats(OUT/"NEON_BOY_V5_STATIC.glb"),
     "source":"Grab3D Hoodie Teen, CC0 1.0, sculpted and auto-rigged source; modified by MARK",
     "base_mesh_vertices":len(body.data.vertices),
     "headwear_and_print_meshes":len(parts),
     "texture":"preserved original real garment texture, recolored to navy+charcoal",
     "limitations":"Not tested in MARK Editor or on Huawei. Exact image likeness not guaranteed."}
assert out["animated"]["skins"]>0 and out["animated"]["animations"]>0
(OUT/"validation.json").write_text(json.dumps(out,indent=2),encoding="utf-8")
print("NEON_V5_FINAL_SUCCESS",json.dumps(out),flush=True)
