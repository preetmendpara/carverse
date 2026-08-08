/**
 * Demo inventory: 1-2 cars for every curated brand. Photos are sourced from
 * public Wikimedia/Wikipedia media (the model line-up mirrors the kind of stock
 * listed on bigboytoyz.com). These are display-only fallbacks used until real
 * cars are written into Firestore, and they double as the payload behind the
 * admin "Import demo cars" action.
 */
import { BRAND_SEED } from "./brand-logos.js";
import { photosFor } from "./car-photos.js";

const key = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const slug = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const CAR_SEED = [
  {
    "brand": "Lamborghini",
    "model": "Huracan EVO",
    "year": 2021,
    "price": 43590000,
    "mileage": "15,600 km",
    "fuelType": "Petrol",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/ca/2017_Lamborghini_Huracan_LP610.jpg/1280px-2017_Lamborghini_Huracan_LP610.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": true
  },
  {
    "brand": "Lamborghini",
    "model": "Urus",
    "year": 2019,
    "price": 35130000,
    "mileage": "21,000 km",
    "fuelType": "Petrol",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f1/Lamborghini_Urus_SE_DSC_8524.jpg/1280px-Lamborghini_Urus_SE_DSC_8524.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": false
  },
  {
    "brand": "Ferrari",
    "model": "488 GTB",
    "year": 2019,
    "price": 43390000,
    "mileage": "4,200 km",
    "fuelType": "Petrol",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/36/2016_Ferrari_488_Spider_%2838806%29.jpg/1280px-2016_Ferrari_488_Spider_%2838806%29.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": false
  },
  {
    "brand": "Ferrari",
    "model": "Roma",
    "year": 2023,
    "price": 41730000,
    "mileage": "4,200 km",
    "fuelType": "Petrol",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9d/2021_Ferrari_Roma_in_Rosso_Fiorano%2C_front_right.jpg/1280px-2021_Ferrari_Roma_in_Rosso_Fiorano%2C_front_right.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": false
  },
  {
    "brand": "Rolls-Royce",
    "model": "Ghost",
    "year": 2022,
    "price": 68710000,
    "mileage": "7,800 km",
    "fuelType": "Petrol",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/97/2022_Rolls-Royce_Ghost_Black_Badge_in_Arctic_White%2C_front_left.jpg/1280px-2022_Rolls-Royce_Ghost_Black_Badge_in_Arctic_White%2C_front_left.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": false
  },
  {
    "brand": "Rolls-Royce",
    "model": "Cullinan",
    "year": 2019,
    "price": 71000000,
    "mileage": "4,200 km",
    "fuelType": "Petrol",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0d/2019_Rolls-Royce_Cullinan_V12_Automatic_6.75_Front.jpg/1280px-2019_Rolls-Royce_Cullinan_V12_Automatic_6.75_Front.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": false
  },
  {
    "brand": "Bentley",
    "model": "Continental GT",
    "year": 2023,
    "price": 32240000,
    "mileage": "7,800 km",
    "fuelType": "Petrol",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e1/Bentley_Continental_GT_First_Edition_%2849919050697%29_%28cropped%29_%28cropped%29.jpg/1280px-Bentley_Continental_GT_First_Edition_%2849919050697%29_%28cropped%29_%28cropped%29.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": false
  },
  {
    "brand": "Bentley",
    "model": "Bentayga",
    "year": 2023,
    "price": 39440000,
    "mileage": "21,000 km",
    "fuelType": "Petrol",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d0/Bentley_Bentayga_V8_%28FL%29_IMG_0005.jpg/1280px-Bentley_Bentayga_V8_%28FL%29_IMG_0005.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": true
  },
  {
    "brand": "Porsche",
    "model": "911 Carrera S",
    "year": 2023,
    "price": 20040000,
    "mileage": "7,800 km",
    "fuelType": "Petrol",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/2025_Porsche_992_Carrera_convertible_DSC_7026.jpg/1280px-2025_Porsche_992_Carrera_convertible_DSC_7026.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": false
  },
  {
    "brand": "Porsche",
    "model": "Cayenne",
    "year": 2019,
    "price": 20850000,
    "mileage": "7,800 km",
    "fuelType": "Petrol",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fb/Porsche_Cayenne_%28III%2C_Facelift%29_%E2%80%93_f_01012025.jpg/1280px-Porsche_Cayenne_%28III%2C_Facelift%29_%E2%80%93_f_01012025.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": false
  },
  {
    "brand": "Mercedes-Benz",
    "model": "G 63 AMG",
    "year": 2021,
    "price": 16490000,
    "mileage": "21,000 km",
    "fuelType": "Petrol",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/38/Mercedes-Benz_W463_G_350_BlueTEC_01.jpg/1280px-Mercedes-Benz_W463_G_350_BlueTEC_01.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": false
  },
  {
    "brand": "Mercedes-Benz",
    "model": "S-Class",
    "year": 2019,
    "price": 17120000,
    "mileage": "21,000 km",
    "fuelType": "Petrol",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/55/Mercedes-Benz_W223_IMG_6663.jpg/1280px-Mercedes-Benz_W223_IMG_6663.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": false
  },
  {
    "brand": "BMW",
    "model": "M4 Competition",
    "year": 2020,
    "price": 10120000,
    "mileage": "21,000 km",
    "fuelType": "Petrol",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e2/2021_BMW_M4_Competition_Automatic_3.0_Front.jpg/1280px-2021_BMW_M4_Competition_Automatic_3.0_Front.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": false
  },
  {
    "brand": "BMW",
    "model": "X7",
    "year": 2020,
    "price": 10860000,
    "mileage": "21,000 km",
    "fuelType": "Petrol",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/00/BMW_G07_1X7A1696.jpg/1280px-BMW_G07_1X7A1696.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": false
  },
  {
    "brand": "Audi",
    "model": "RS7 Sportback",
    "year": 2019,
    "price": 10440000,
    "mileage": "21,000 km",
    "fuelType": "Petrol",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d2/2018_Audi_A7_S_Line_40_TDi_S-A_2.0.jpg/1280px-2018_Audi_A7_S_Line_40_TDi_S-A_2.0.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": true
  },
  {
    "brand": "Audi",
    "model": "Q8",
    "year": 2020,
    "price": 10270000,
    "mileage": "21,000 km",
    "fuelType": "Petrol",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/2018_Audi_Q8_S_Line_50_TDi_Quattro_3.0_Front.jpg/1280px-2018_Audi_Q8_S_Line_50_TDi_Quattro_3.0_Front.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": false
  },
  {
    "brand": "Aston Martin",
    "model": "DB11",
    "year": 2022,
    "price": 34950000,
    "mileage": "15,600 km",
    "fuelType": "Petrol",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/92/2018_Aston_Martin_DB11_V8_Automatic_4.0_Front.jpg/1280px-2018_Aston_Martin_DB11_V8_Automatic_4.0_Front.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": false
  },
  {
    "brand": "Aston Martin",
    "model": "DBX",
    "year": 2023,
    "price": 36130000,
    "mileage": "11,500 km",
    "fuelType": "Petrol",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/2021_Aston_Martin_DBX_in_Midnight_Blue%2C_front_left.jpg/1280px-2021_Aston_Martin_DBX_in_Midnight_Blue%2C_front_left.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": false
  },
  {
    "brand": "McLaren",
    "model": "720S",
    "year": 2021,
    "price": 48240000,
    "mileage": "7,800 km",
    "fuelType": "Petrol",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/23/2018_McLaren_720S_V8_S-A_4.0.jpg/1280px-2018_McLaren_720S_V8_S-A_4.0.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": false
  },
  {
    "brand": "McLaren",
    "model": "GT",
    "year": 2020,
    "price": 46130000,
    "mileage": "11,500 km",
    "fuelType": "Petrol",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/2022_McLaren_GT.jpg/1280px-2022_McLaren_GT.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": false
  },
  {
    "brand": "Bugatti",
    "model": "Chiron",
    "year": 2023,
    "price": 177430000,
    "mileage": "11,500 km",
    "fuelType": "Petrol",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/18/Bugatti_Chiron_1.jpg/1280px-Bugatti_Chiron_1.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": false
  },
  {
    "brand": "Bugatti",
    "model": "Veyron",
    "year": 2022,
    "price": 168380000,
    "mileage": "4,200 km",
    "fuelType": "Petrol",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c9/Bugatti_Veyron_16.4_%E2%80%93_Frontansicht_%281%29%2C_5._April_2012%2C_D%C3%BCsseldorf.jpg/1280px-Bugatti_Veyron_16.4_%E2%80%93_Frontansicht_%281%29%2C_5._April_2012%2C_D%C3%BCsseldorf.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": true
  },
  {
    "brand": "Maserati",
    "model": "Ghibli",
    "year": 2019,
    "price": 13120000,
    "mileage": "7,800 km",
    "fuelType": "Petrol",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/2018_Maserati_Ghibli_GranLusso_Diesel_3.0_facelift_Front.jpg/1280px-2018_Maserati_Ghibli_GranLusso_Diesel_3.0_facelift_Front.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": false
  },
  {
    "brand": "Maserati",
    "model": "Levante",
    "year": 2021,
    "price": 11960000,
    "mileage": "15,600 km",
    "fuelType": "Petrol",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Maserati_Levante_S_%2801%29.jpg/1280px-Maserati_Levante_S_%2801%29.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": false
  },
  {
    "brand": "Land Rover",
    "model": "Range Rover Vogue",
    "year": 2022,
    "price": 13260000,
    "mileage": "26,400 km",
    "fuelType": "Diesel",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/17/2022_Land_Rover_Range_Rover_SE_P440e_AWD_Automatic_3.0_Front.jpg/1280px-2022_Land_Rover_Range_Rover_SE_P440e_AWD_Automatic_3.0_Front.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": false
  },
  {
    "brand": "Land Rover",
    "model": "Defender 110",
    "year": 2019,
    "price": 15930000,
    "mileage": "21,000 km",
    "fuelType": "Diesel",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/2015_Land_Rover_Defender_%28L316_MY15%29_90_3-door_wagon_%282015-10-24%29_01.jpg/1280px-2015_Land_Rover_Defender_%28L316_MY15%29_90_3-door_wagon_%282015-10-24%29_01.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": false
  },
  {
    "brand": "Jaguar",
    "model": "F-Type",
    "year": 2021,
    "price": 8080000,
    "mileage": "11,500 km",
    "fuelType": "Petrol",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d5/2017_Jaguar_F-Type_V6_R-Dynamic_Automatic_3.0_Front.jpg/1280px-2017_Jaguar_F-Type_V6_R-Dynamic_Automatic_3.0_Front.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": false
  },
  {
    "brand": "Jaguar",
    "model": "F-Pace",
    "year": 2023,
    "price": 8400000,
    "mileage": "32,000 km",
    "fuelType": "Petrol",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1f/Jaguar_F-Pace_AWD_20d_registered_March_2019_1999cc_01_%28cropped%29.jpg/1280px-Jaguar_F-Pace_AWD_20d_registered_March_2019_1999cc_01_%28cropped%29.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": false
  },
  {
    "brand": "Lexus",
    "model": "LX 570",
    "year": 2022,
    "price": 9190000,
    "mileage": "4,200 km",
    "fuelType": "Petrol",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/34/2018_Lexus_LX_570_%28facelift%29%2C_front_3.24.23.jpg/1280px-2018_Lexus_LX_570_%28facelift%29%2C_front_3.24.23.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": true
  },
  {
    "brand": "Lexus",
    "model": "ES 300h",
    "year": 2021,
    "price": 10210000,
    "mileage": "26,400 km",
    "fuelType": "Petrol",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7c/Lexus_ES_350_%28GSZ10%29_IMG_4332.jpg/1280px-Lexus_ES_350_%28GSZ10%29_IMG_4332.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": false
  },
  {
    "brand": "Volvo",
    "model": "XC90",
    "year": 2019,
    "price": 6250000,
    "mileage": "26,400 km",
    "fuelType": "Petrol",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/23/Volvo_XC90_T8_AWD_Plug-in_Hybrid_Plus_%28II%2C_2._Facelift%29_%E2%80%93_f_03102025.jpg/1280px-Volvo_XC90_T8_AWD_Plug-in_Hybrid_Plus_%28II%2C_2._Facelift%29_%E2%80%93_f_03102025.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": false
  },
  {
    "brand": "Volvo",
    "model": "S90",
    "year": 2021,
    "price": 7260000,
    "mileage": "26,400 km",
    "fuelType": "Petrol",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/2018_Volvo_S90_T5_Momentum_front_4.6.18.jpg/1280px-2018_Volvo_S90_T5_Momentum_front_4.6.18.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": false
  },
  {
    "brand": "MINI",
    "model": "Cooper S",
    "year": 2022,
    "price": 3980000,
    "mileage": "15,600 km",
    "fuelType": "Petrol",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c4/Mini_Hatch_%28J01%29_Ditzingen_Mobil_IMG_9772_%28cropped%29.jpg/1280px-Mini_Hatch_%28J01%29_Ditzingen_Mobil_IMG_9772_%28cropped%29.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": false
  },
  {
    "brand": "MINI",
    "model": "Countryman",
    "year": 2021,
    "price": 3710000,
    "mileage": "15,600 km",
    "fuelType": "Petrol",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bc/2018_Mini_Countryman_Cooper_S_2.0_Front.jpg/1280px-2018_Mini_Countryman_Cooper_S_2.0_Front.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": false
  },
  {
    "brand": "Jeep",
    "model": "Wrangler Rubicon",
    "year": 2021,
    "price": 5150000,
    "mileage": "4,200 km",
    "fuelType": "Diesel",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/81/Jeep_Wrangler_Unlimited_%28JL%29_PHEV_IMG_5808.jpg/1280px-Jeep_Wrangler_Unlimited_%28JL%29_PHEV_IMG_5808.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": false
  },
  {
    "brand": "Jeep",
    "model": "Grand Cherokee",
    "year": 2022,
    "price": 5000000,
    "mileage": "32,000 km",
    "fuelType": "Diesel",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6c/2022_Jeep_Grand_Cherokee_Summit_Reserve_4x4_in_Bright_White%2C_Front_Left%2C_01-16-2022.jpg/1280px-2022_Jeep_Grand_Cherokee_Summit_Reserve_4x4_in_Bright_White%2C_Front_Left%2C_01-16-2022.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": true
  },
  {
    "brand": "Cadillac",
    "model": "Escalade",
    "year": 2021,
    "price": 8070000,
    "mileage": "7,800 km",
    "fuelType": "Petrol",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/30/2026_Cadillac_Escalade_ESV.jpg/1280px-2026_Cadillac_Escalade_ESV.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": false
  },
  {
    "brand": "Cadillac",
    "model": "CT5",
    "year": 2022,
    "price": 8640000,
    "mileage": "32,000 km",
    "fuelType": "Petrol",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/28/2024_Cadillac_CT5-V_AWD%2C_front_12.20.24.jpg/1280px-2024_Cadillac_CT5-V_AWD%2C_front_12.20.24.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": false
  },
  {
    "brand": "Chevrolet",
    "model": "Camaro SS",
    "year": 2022,
    "price": 5860000,
    "mileage": "15,600 km",
    "fuelType": "Petrol",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/2019_Chevrolet_Camaro_2SS_6.2L_front_3.16.19.jpg/1280px-2019_Chevrolet_Camaro_2SS_6.2L_front_3.16.19.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": false
  },
  {
    "brand": "Chevrolet",
    "model": "Corvette C8",
    "year": 2022,
    "price": 6620000,
    "mileage": "7,800 km",
    "fuelType": "Petrol",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4b/Chevrolet_Corvette_C8_IAA_2021_1X7A0156.jpg/1280px-Chevrolet_Corvette_C8_IAA_2021_1X7A0156.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": false
  },
  {
    "brand": "Ford",
    "model": "Mustang GT",
    "year": 2022,
    "price": 6620000,
    "mileage": "11,500 km",
    "fuelType": "Petrol",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1f/2019_Ford_Mustang_GT_5.0_facelift.jpg/1280px-2019_Ford_Mustang_GT_5.0_facelift.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": false
  },
  {
    "brand": "Ford",
    "model": "F-150 Raptor",
    "year": 2022,
    "price": 6800000,
    "mileage": "26,400 km",
    "fuelType": "Petrol",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/2018_Ford_F-150_XLT_Crew_Cab%2C_front_11.10.19.jpg/1280px-2018_Ford_F-150_XLT_Crew_Cab%2C_front_11.10.19.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": false
  },
  {
    "brand": "Tesla",
    "model": "Model S Plaid",
    "year": 2022,
    "price": 9360000,
    "mileage": "7,800 km",
    "fuelType": "Electric",
    "transmission": "Electric",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9e/Tesla_Model_S_%28Facelift_ab_04-2016%29_%28cropped%29.jpg/1280px-Tesla_Model_S_%28Facelift_ab_04-2016%29_%28cropped%29.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": true
  },
  {
    "brand": "Tesla",
    "model": "Model X",
    "year": 2019,
    "price": 7740000,
    "mileage": "7,800 km",
    "fuelType": "Electric",
    "transmission": "Electric",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/92/2017_Tesla_Model_X_100D_Front.jpg/1280px-2017_Tesla_Model_X_100D_Front.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": false
  },
  {
    "brand": "Toyota",
    "model": "Land Cruiser 300",
    "year": 2020,
    "price": 9870000,
    "mileage": "32,000 km",
    "fuelType": "Diesel",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6d/2021_Toyota_Land_Cruiser_300_3.4_ZX_%28Colombia%29_front_view_04.png/1280px-2021_Toyota_Land_Cruiser_300_3.4_ZX_%28Colombia%29_front_view_04.png?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": false
  },
  {
    "brand": "Toyota",
    "model": "Fortuner",
    "year": 2023,
    "price": 10340000,
    "mileage": "11,500 km",
    "fuelType": "Diesel",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/66/2015_Toyota_Fortuner_%28New_Zealand%29.jpg/1280px-2015_Toyota_Fortuner_%28New_Zealand%29.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": false
  },
  {
    "brand": "Nissan",
    "model": "GT-R",
    "year": 2019,
    "price": 12800000,
    "mileage": "21,000 km",
    "fuelType": "Petrol",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ef/2009-2010_Nissan_GT-R_%28R35%29_coupe_01.jpg/1280px-2009-2010_Nissan_GT-R_%28R35%29_coupe_01.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": false
  },
  {
    "brand": "Nissan",
    "model": "Patrol",
    "year": 2021,
    "price": 14400000,
    "mileage": "11,500 km",
    "fuelType": "Petrol",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9d/2016_Nissan_Patrol_%28Y62%29_Ti-L_wagon_%282018-09-17%29_01.jpg/1280px-2016_Nissan_Patrol_%28Y62%29_Ti-L_wagon_%282018-09-17%29_01.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": false
  },
  {
    "brand": "Koenigsegg",
    "model": "Jesko",
    "year": 2020,
    "price": 244700000,
    "mileage": "21,000 km",
    "fuelType": "Petrol",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9f/GIMS_2019%2C_Le_Grand-Saconnex_%28GIMS0833%29.jpg/1280px-GIMS_2019%2C_Le_Grand-Saconnex_%28GIMS0833%29.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": false
  },
  {
    "brand": "Koenigsegg",
    "model": "Regera",
    "year": 2023,
    "price": 242660000,
    "mileage": "26,400 km",
    "fuelType": "Petrol",
    "transmission": "Automatic",
    "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b6/Regera_%28light_gradient%29.png/1280px-Regera_%28light_gradient%29.png?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail",
    "featured": true
  }
];

const specs = (c) => ({
  Year: String(c.year),
  Fuel: c.fuelType,
  Transmission: c.transmission,
  "Odometer": c.mileage,
  "Registration": "Available on request",
  "Ownership": "First owner",
});

const features = [
  "Panoramic sunroof",
  "Ventilated leather seats",
  "360° camera",
  "Adaptive cruise control",
  "Premium surround sound",
  "Ambient lighting",
];

const brandCountry = (name) => (BRAND_SEED.find((b) => b.name === name) || {}).country || "";

/** Car payloads ready to be written to Firestore (brandId resolved by caller). */
export const carSeedDocs = (brandIdByName = {}) =>
  CAR_SEED.map((c) => {
    const id = `${slug(c.brand)}-${slug(c.model)}`;
    const { exterior, interior } = photosFor(id);
    // Same car, same colour: prefer the single-photoshoot set; fall back to the cover.
    const gallery = (exterior.length ? exterior : [c.image]).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);
    return {
    brandId: brandIdByName[c.brand] || key(c.brand),
    brandName: c.brand,
    model: c.model,
    variant: "",
    year: c.year,
    price: c.price,
    mileage: c.mileage,
    fuelType: c.fuelType,
    transmission: c.transmission,
    status: "published",
    availability: "in-stock",
    featured: c.featured,
    mainImage: gallery[0] || c.image,
    gallery,
    exterior: gallery,
    interior,
    modelUrl: "",
    description: `${c.year} ${c.brand} ${c.model} from ${brandCountry(c.brand)} — inspected, certified and ready for delivery.`,
    specifications: specs(c),
    features,
    };
  });

/** Display-only cars used until the Firestore `cars` collection is filled. */
export const fallbackCars = () =>
  carSeedDocs().map((c, i) => ({
    id: `${slug(c.brandName)}-${slug(c.model)}`,
    createdAtMs: Date.now() - i * 1000,
    isFallback: true,
    ...c,
  }));

/** Lookup used by the details page when Firestore has no matching doc. */
export const fallbackCarById = (id) => fallbackCars().find((c) => c.id === id) || null;
