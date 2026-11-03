<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class AppSetting extends Model
{
    use HasFactory;

    protected $table = 'app_settings';

    protected $fillable = [
        'setting_key',
        'setting_value',
        'setting_type',
        'description',
    ];

    public static function getVal(string $key, $default = null)
    {
        $setting = static::where('setting_key', $key)->first();
        if (!$setting) {
            return $default;
        }

        switch ($setting->setting_type) {
            case 'boolean':
                return filter_var($setting->setting_value, FILTER_VALIDATE_BOOLEAN);
            case 'integer':
                return (int) $setting->setting_value;
            case 'json':
                return json_decode($setting->setting_value, true);
            default:
                return $setting->setting_value;
        }
    }

    public static function setVal(string $key, $value, string $type = 'string', ?string $desc = null): self
    {
        $stringVal = is_array($value) ? json_encode($value) : (string) $value;

        return static::updateOrCreate(
            ['setting_key' => $key],
            [
                'setting_value' => $stringVal,
                'setting_type' => $type,
                'description' => $desc,
            ]
        );
    }
}
