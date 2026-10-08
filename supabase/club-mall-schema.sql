-- 积分兑换商城
-- 独立新表；权限字段 can_mall 追加到 club_staff_permissions。
-- 配图仅存可选 image_url（外链图床），不做 Storage 上传。
-- 兑换：立即扣积分并减库存；「已处理」= 删除兑换记录。

alter table public.club_staff_permissions
  add column if not exists can_mall boolean not null default false;

create table if not exists public.club_mall_products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  description text not null default '',
  image_url text not null default '',
  price integer not null check (price >= 1 and price <= 1000000),
  stock integer not null check (stock >= 0 and stock <= 1000000),
  is_listed boolean not null default false,
  sort_order integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists club_mall_products_listed_idx
  on public.club_mall_products (is_listed, sort_order asc, updated_at desc);

create index if not exists club_mall_products_updated_idx
  on public.club_mall_products (updated_at desc);

alter table public.club_mall_products enable row level security;
revoke all on table public.club_mall_products from public, anon, authenticated;
grant select, insert, update, delete on table public.club_mall_products to service_role;

create table if not exists public.club_mall_redemptions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.club_mall_products(id) on delete set null,
  product_name text not null,
  product_price integer not null check (product_price >= 1),
  user_id uuid references auth.users(id) on delete set null,
  username text not null default '',
  member_name text not null default '',
  member_class text not null default '',
  points_spent integer not null check (points_spent >= 1),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists club_mall_redemptions_created_idx
  on public.club_mall_redemptions (created_at desc);

create index if not exists club_mall_redemptions_user_idx
  on public.club_mall_redemptions (user_id, created_at desc);

alter table public.club_mall_redemptions enable row level security;
revoke all on table public.club_mall_redemptions from public, anon, authenticated;
grant select, insert, update, delete on table public.club_mall_redemptions to service_role;

create or replace function public.set_club_mall_products_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists club_mall_products_updated_at on public.club_mall_products;
create trigger club_mall_products_updated_at
before update on public.club_mall_products
for each row execute function public.set_club_mall_products_updated_at();

-- 原子兑换：校验上架/库存/绑定积分 → 扣分 → 减库存 → 写兑换记录
create or replace function public.redeem_club_mall_product(
  p_user_id uuid,
  p_username text,
  p_product_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product public.club_mall_products%rowtype;
  v_profile public.club_member_profiles%rowtype;
  v_points public.club_member_points%rowtype;
  v_username text := coalesce(nullif(trim(p_username), ''), '');
  v_member_name text := '';
  v_member_class text := '';
  v_has_points boolean := false;
  v_redemption public.club_mall_redemptions%rowtype;
begin
  if p_user_id is null then
    raise exception '请先登录后再兑换。';
  end if;
  if p_product_id is null then
    raise exception '缺少商品编号。';
  end if;

  select * into v_product
  from public.club_mall_products
  where id = p_product_id
  for update;

  if not found then
    raise exception '商品不存在。';
  end if;
  if not v_product.is_listed then
    raise exception '该商品未上架。';
  end if;
  if v_product.stock <= 0 then
    raise exception '库存不足。';
  end if;

  select * into v_profile
  from public.club_member_profiles
  where user_id = p_user_id
  limit 1;

  if found then
    v_member_name := coalesce(nullif(trim(v_profile.member_name), ''), '');
    v_member_class := coalesce(nullif(trim(v_profile.member_class), ''), '');

    if v_member_name <> '' and v_member_class <> '' then
      if v_profile.points_member_id is not null then
        select * into v_points
        from public.club_member_points
        where id = v_profile.points_member_id
        for update;
        v_has_points := found;
      end if;

      if not v_has_points then
        select * into v_points
        from public.club_member_points
        where member_name = v_member_name
          and member_class = v_member_class
        for update;
        v_has_points := found;
      end if;
    end if;
  end if;

  if not v_has_points then
    raise exception '请先在个人中心绑定姓名班级并确认积分榜有记录后再兑换。';
  end if;

  if v_points.points < v_product.price then
    raise exception '积分不足，当前积分 %，需要 %。', v_points.points, v_product.price;
  end if;

  update public.club_member_points
  set points = points - v_product.price,
      updated_at = timezone('utc', now())
  where id = v_points.id
    and points >= v_product.price;

  if not found then
    raise exception '积分不足或积分记录已变更，请刷新后重试。';
  end if;

  update public.club_mall_products
  set stock = stock - 1,
      updated_at = timezone('utc', now())
  where id = v_product.id
    and stock > 0
    and is_listed = true;

  if not found then
    raise exception '库存不足或商品已下架，请刷新后重试。';
  end if;

  insert into public.club_mall_redemptions (
    product_id,
    product_name,
    product_price,
    user_id,
    username,
    member_name,
    member_class,
    points_spent
  ) values (
    v_product.id,
    v_product.name,
    v_product.price,
    p_user_id,
    v_username,
    v_member_name,
    v_member_class,
    v_product.price
  )
  returning * into v_redemption;

  return jsonb_build_object(
    'redemption', to_jsonb(v_redemption),
    'remaining_points', v_points.points - v_product.price,
    'remaining_stock', v_product.stock - 1
  );
end;
$$;

revoke all on function public.redeem_club_mall_product(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.redeem_club_mall_product(uuid, text, uuid) to service_role;
